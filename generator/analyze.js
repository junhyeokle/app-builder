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

const SYSTEM_PROMPT = `You are the requirement-analysis step of a no-code mobile app builder. The platform can currently only build one shape of app: a single-resource list screen behind login (think: todo list, shopping list, habit tracker, reading list, simple booking list, etc.) — one Supabase table owned by the signed-in user, shown as a list with add / toggle-done / delete.

Your job, given the user's natural-language request (in Korean or English), is to either:
(a) ask ONE short, non-technical clarifying question if something important is missing or ambiguous, or
(b) if you have enough information, output the final structured spec.

Rules for clarifying questions:
- Ask about the PRODUCT (what the user wants), never about implementation (never ask about databases, frameworks, APIs, etc.).
- Ask at most ONE question at a time.
- Good question example: "완료한 항목도 계속 목록에 보여야 하나요, 아니면 숨겨져도 되나요?"
- Bad question example: "어떤 데이터베이스를 쓸까요?"
- If the user's request is clearly outside the supported shape (e.g. real-time chat, maps, media feed), still do your best to map it onto the closest single-list-screen approximation rather than refusing — note the simplification in a short friendly sentence when you output the final spec.
- Don't ask more than 3 questions total across the whole conversation. If still ambiguous after that, make a reasonable default choice yourself.

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

When you need to ask a clarifying question, respond with EXACTLY:
===QUESTION===
<your one question, in the same language the user is writing in>
===END===

OR, when ready to finalize:
===SPEC===
<the final JSON spec, valid JSON only>
===END===
===NOTE===
<one short friendly sentence in the same language the user is writing in, summarizing what you're building and noting any simplification you made. Omit this block if there is nothing worth noting.>
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
