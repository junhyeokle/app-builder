// M3: natural-language prompt -> clarifying questions -> structured spec.
// The output spec has the exact same shape as generator/specs/*.json, so it
// feeds directly into M2's generate.js (chained automatically at the end).
//
// Usage (CLI, one project at a time):
//   node analyze.js <projectId> "<message>"
// Run it again with the next message each time (conversation state is
// persisted to .sessions/<projectId>.json between runs, since this isn't
// driven by a long-lived interactive terminal). projectId is also forced to
// become the final spec's slug, so a platform UI can keep a stable URL/id
// for the project across the whole conversation even though the AI only
// decides the app's *name* at the end.
//
// Add --json as the last arg to get a single machine-readable result line
// (prefixed "RESULT_JSON:") instead of the human-readable console output -
// this is what the Next.js platform's API route uses.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const SPECS_DIR = path.join(__dirname, 'specs');
const SESSIONS_DIR = path.join(__dirname, '.sessions');

const SYSTEM_PROMPT = `You are a teammate helping someone build a mobile app - not a form-filling bot, not a customer-support script. Talk the way a genuinely invested co-founder or engineer on the team would: natural, warm, opinionated when it helps, and actually engaged with making this app good. Use collaborative framing where it fits ("같이 만들어봐요", "이렇게 해볼까요?", "저라면 이렇게 할 것 같아요") instead of service-desk phrasing ("요청하신 대로 처리했습니다").

Platform capability (keep this in mind, but never recite it to the user like a rulebook): this version builds apps shaped like a single-resource list screen behind login (think: todo list, shopping list, habit tracker, reading list, etc.) - one table owned by the signed-in user, shown as a list with add/toggle/delete. If the user's idea doesn't naturally fit this shape, do your best to map it onto the closest reasonable approximation, and mention the simplification candidly and conversationally when you finalize - not as a disclaimer, more like a teammate explaining a judgment call they made.

How to run the conversation:
- Actually engage with their idea. Acknowledge what they said, react to it, offer your own opinion or a suggestion when it's genuinely useful (e.g. "오, 운동 기록 앱이면 세트/횟수까지 기록하고 싶을 수도 있을 것 같은데, 어떠세요?"). You're allowed to have taste.
- Ask about the PRODUCT (what they want, how it should behave, what matters to them) - never about implementation (never databases, frameworks, APIs, tech stack).
- There's no fixed number of questions. Keep going as long as there's something genuinely useful left to clarify - use real judgment, like a good engineer gathering requirements would. Some ideas need one question, some need several. Don't ask about things that don't matter just to seem thorough.
- Once you think you have enough to build something they'll actually be happy with, say so and offer to proceed (e.g. "지금까지 얘기한 걸로 꽤 괜찮은 앱이 나올 것 같은데, 더 추가하고 싶은 거 있으세요? 아니면 이걸로 만들어볼까요?") rather than silently finalizing without warning - unless they've already told you to go ahead.
- If the user signals they're done deciding - "이제 만들어줘", "더 없어", "그냥 만들어", "진행해줘" or similar - treat that as green light to finalize immediately, even mid-thought. Fill any remaining gaps with your own reasonable judgment instead of asking again.
- Don't let it drag on either. If you notice you're reaching for questions that don't really matter, or the conversation's energy says "let's just build it," read the room and wrap up.

The final spec MUST follow this exact JSON shape (field "type" must be one of: text, integer, boolean, date):

{
  "appName": "<Human readable app name>",
  "slug": "<kebab-case-slug>",
  "resource": {
    "table": "<snake_case_plural_table_name>",
    "tsTypeName": "<PascalCase singular type name>",
    "libFileName": "<kebab-case-plural>",
    "fields": [
      { "name": "<snake_case>", "type": "text|integer|boolean|date", "tsType": "string|number|boolean|string | null", "required": true|false, "default": <optional> }
    ],
    "orderBy": [ { "field": "<name>", "ascending": true|false } ]
  },
  "screen": {
    "title": "<Screen title>",
    "description": "<1-3 sentences describing the list screen behavior, in the same level of detail as: 'A single list screen showing shopping items... Supports: add item by name, tap to toggle purchased, delete item.'>"
  }
}

When you want to keep the conversation going (react, suggest, ask something, or offer to wrap up), respond with EXACTLY:
===QUESTION===
<your natural reply, in the same language the user is writing in - can acknowledge/react/suggest, should end with a clear question or a clear next step>
===END===

OR, when ready to finalize:
===SPEC===
<the final JSON spec, valid JSON only>
===END===
===NOTE===
<a sentence or two, in the same language and the same collaborative tone, summarizing what you built together and noting any simplification - talk like you just finished building this with them, not like a changelog entry>
===END===

Never output anything outside these blocks.`;

function parseModelReply(text) {
  const questionMatch = text.match(/===QUESTION===([\s\S]*?)===END===/);
  if (questionMatch) {
    return { type: 'question', question: questionMatch[1].trim() };
  }
  const specMatch = text.match(/===SPEC===([\s\S]*?)===END===/);
  const noteMatch = text.match(/===NOTE===([\s\S]*?)===END===/);
  if (specMatch) {
    return {
      type: 'spec',
      spec: JSON.parse(specMatch[1].trim()),
      note: noteMatch ? noteMatch[1].trim() : null,
    };
  }
  throw new Error('Could not parse model reply:\n' + text);
}

async function sendWithRetry(chat, message) {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await chat.sendMessage(message);
      return result.response.text();
    } catch (err) {
      const retryable = err?.status === 503 || err?.status === 429;
      if (!retryable || attempt === maxAttempts) throw err;
      const waitMs = attempt * 5000;
      console.log(`  (busy, retrying in ${waitMs / 1000}s...)`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

async function main() {
  const asJson = process.argv.at(-1) === '--json';
  const args = asJson ? process.argv.slice(2, -1) : process.argv.slice(2);
  const [projectId, userMessage] = args;

  if (!projectId || !userMessage) {
    console.error('Usage: node analyze.js <projectId> "<message>" [--json]');
    process.exit(1);
  }

  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  const sessionFile = path.join(SESSIONS_DIR, `${projectId}.json`);
  const savedHistory = fs.existsSync(sessionFile) ? JSON.parse(fs.readFileSync(sessionFile, 'utf8')) : [];

  if (!asJson) {
    console.log(savedHistory.length === 0 ? `\n[새 대화 시작]\n사용자: ${userMessage}\n` : `\n[이어서 답변]: ${userMessage}\n`);
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite', systemInstruction: SYSTEM_PROMPT });
  const chat = model.startChat({ history: savedHistory });

  const replyText = await sendWithRetry(chat, userMessage);
  const parsed = parseModelReply(replyText);
  const updatedHistory = await chat.getHistory();

  if (parsed.type === 'question') {
    fs.writeFileSync(sessionFile, JSON.stringify(updatedHistory, null, 2));
    if (asJson) {
      console.log('RESULT_JSON:' + JSON.stringify({ type: 'question', question: parsed.question }));
    } else {
      console.log(`AI: ${parsed.question}`);
      console.log(`\n이 질문에 답하려면 다음과 같이 다시 실행해주세요:`);
      console.log(`  node analyze.js ${projectId} "<답변>"`);
    }
    return;
  }

  // type === 'spec' -> conversation finished, clear session.
  // Force the spec's slug to the caller's stable projectId, so the project's
  // URL/identity doesn't depend on what the AI happened to name the app.
  parsed.spec.slug = projectId;
  if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile);

  if (!asJson) {
    if (parsed.note) console.log(`AI: ${parsed.note}\n`);
    console.log('--- 최종 스펙 ---');
    console.log(JSON.stringify(parsed.spec, null, 2));
  }

  fs.mkdirSync(SPECS_DIR, { recursive: true });
  const specPath = path.join(SPECS_DIR, `${parsed.spec.slug}.json`);
  fs.writeFileSync(specPath, JSON.stringify(parsed.spec, null, 2));
  if (!asJson) console.log(`\n스펙 저장: generator/specs/${parsed.spec.slug}.json`);

  if (!asJson) console.log(`\n이제 M2 generate.js를 자동으로 실행합니다...\n`);
  let generateOk = true;
  try {
    execSync(`node generate.js ${parsed.spec.slug}`, { cwd: __dirname, stdio: asJson ? 'pipe' : 'inherit' });
  } catch {
    generateOk = false;
  }

  if (asJson) {
    console.log(
      'RESULT_JSON:' +
        JSON.stringify({ type: 'spec', spec: parsed.spec, note: parsed.note, generateOk })
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
