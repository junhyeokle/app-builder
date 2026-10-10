// V0.2: post-generation modification. Only runs against an already-generated
// project (see generate.js / ROADMAP.md's modification architecture notes).
//
// Scope is policy-limited on purpose (ROADMAP.md): V0.2 only allows
// ADD_FIELD, UI_CHANGE, BEHAVIOR_CHANGE. Anything else is declined, not
// attempted. The pipeline itself is written to be extensible (just add
// enum values + prompt instructions later), not rearchitected per version.
//
// Usage: node modify.js <slug> "<modification request>" [--json]

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const OUT_BASE = process.env.GENERATED_PROJECTS_DIR || path.join(ROOT, '..', 'app-builder-generated-projects');
const SPECS_DIR = path.join(__dirname, 'specs');

const ALLOWED_REQUEST_TYPES = ['ADD_FIELD', 'UI_CHANGE', 'BEHAVIOR_CHANGE'];

const SYSTEM_PROMPT = `You are the modification step of a no-code app builder. A user already has a generated app (a single-resource list screen behind login) and is asking for a change.

This version ONLY supports these request types:
- ADD_FIELD: add a new field to the resource (e.g. "add a category field"). Never supports removing or renaming an existing field - that is destructive and not supported yet.
- UI_CHANGE: visual/wording changes within the existing single screen (colors, labels, layout details) - NOT adding new screens, NOT removing the login/signup flow, NOT changing navigation structure.
- BEHAVIOR_CHANGE: logic/behavior changes within the existing screen (e.g. "hide completed items", "sort differently") - still within the single-list-screen shape.

Anything else (removing/renaming fields, removing auth, adding new screens, changing navigation, changing the overall app structure, adding entirely unrelated features) is UNSUPPORTED in this version. When a request is unsupported, say so plainly and do not attempt a partial version of it.

You will be given the current spec and the current contents of three files: a types file, a services file, and the screen file. Only modify what the request actually requires - preserve everything else exactly, including code style and structure.

Respond with ONLY a single JSON object (no markdown fences, no commentary), in this exact shape:

{
  "requestType": "ADD_FIELD" | "UI_CHANGE" | "BEHAVIOR_CHANGE" | "UNSUPPORTED",
  "supported": true or false,
  "declineReason": "<if unsupported, one short friendly sentence explaining why, in the same language as the request>",
  "fieldDelta": { "name": "<snake_case>", "type": "text|integer|boolean|date", "tsType": "string|number|boolean|string | null", "required": true|false, "default": <optional> },
  "note": "<one short friendly sentence summarizing what changed, in the same language as the request>",
  "files": {
    "<types file path>": "<full new file content>",
    "<services file path>": "<full new file content>",
    "<screen file path>": "<full new file content>"
  }
}

Omit "fieldDelta" unless requestType is ADD_FIELD. Omit "files" entirely if supported is false. Only include a file in "files" if it actually changed - if a file doesn't need to change, leave it out.`;

function buildPrompt(spec, currentTypes, currentServices, currentScreen, request, paths) {
  return `${SYSTEM_PROMPT}

Current spec:
${JSON.stringify(spec, null, 2)}

Current ${paths.types}:
---FILE---
${currentTypes}
---END---

Current ${paths.services}:
---FILE---
${currentServices}
---END---

Current ${paths.screen}:
---FILE---
${currentScreen}
---END---

User's modification request: "${request}"

Remember: file paths in your "files" object must be exactly "${paths.types}", "${paths.services}", "${paths.screen}" (only the ones that actually need to change).`;
}

async function callGeminiWithRetry(model, prompt) {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await model.generateContent(prompt);
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

function parseJsonResponse(text) {
  // Models sometimes wrap JSON in markdown fences despite instructions not to.
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
  return JSON.parse(cleaned);
}

async function applyFieldMigration(prefixedTable, field) {
  const sqlType = { text: 'text', integer: 'integer', boolean: 'boolean', date: 'date' }[field.type] || 'text';
  const hasDefault = field.default !== undefined;
  // Adding a NOT NULL column with no default fails outright on a table that
  // already has rows (Postgres has no value to backfill existing rows
  // with) - this is exactly what broke on a real request ("세트당 횟수",
  // required: true, no default). The system silently relaxes to nullable
  // in that case rather than attempting unsafe SQL; field.required is
  // mutated in-place so the caller's spec write reflects what was actually
  // applied, not what was requested.
  if (field.required && !hasDefault) {
    field.required = false;
  }
  const nullClause = field.required && hasDefault ? 'not null' : '';
  const defaultClause = hasDefault ? `default ${JSON.stringify(field.default)}` : '';
  const sql = `alter table public.${prefixedTable} add column if not exists ${field.name} ${sqlType} ${defaultClause} ${nullClause};`.replace(/\s+/g, ' ');

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

function gitRun(cmd, cwd) {
  return execSync(cmd, { cwd, stdio: 'pipe' }).toString();
}

async function main() {
  const asJson = process.argv.at(-1) === '--json';
  const args = asJson ? process.argv.slice(2, -1) : process.argv.slice(2);
  const [slug, request] = args;

  if (!slug || !request) {
    console.error('Usage: node modify.js <slug> "<modification request>" [--json]');
    process.exit(1);
  }

  const projectDir = path.join(OUT_BASE, slug);
  const specPath = path.join(SPECS_DIR, `${slug}.json`);
  if (!fs.existsSync(projectDir) || !fs.existsSync(specPath)) {
    console.error(`No generated project/spec found for "${slug}". Run generate.js first.`);
    process.exit(1);
  }

  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  const paths = {
    types: `src/types/${spec.resource.libFileName}.ts`,
    services: `src/services/${spec.resource.libFileName}.ts`,
    screen: 'src/app/index.tsx',
  };

  const currentTypes = fs.readFileSync(path.join(projectDir, paths.types), 'utf8');
  const currentServices = fs.readFileSync(path.join(projectDir, paths.services), 'utf8');
  const currentScreen = fs.readFileSync(path.join(projectDir, paths.screen), 'utf8');

  console.log(`[1/4] Asking Gemini to classify and plan: "${request}"...`);
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
  const prompt = buildPrompt(spec, currentTypes, currentServices, currentScreen, request, paths);
  const text = await callGeminiWithRetry(model, prompt);
  const result = parseJsonResponse(text);

  if (!result.supported || !ALLOWED_REQUEST_TYPES.includes(result.requestType)) {
    const declineReason =
      result.declineReason || '이 종류의 수정은 아직 지원하지 않습니다. (필드 추가, 화면/문구 변경, 동작 변경만 지원돼요)';
    if (asJson) {
      console.log('RESULT_JSON:' + JSON.stringify({ type: 'declined', reason: declineReason }));
    } else {
      console.log(`거절됨: ${declineReason}`);
    }
    return;
  }

  console.log(`[2/4] Applying ${result.requestType} and writing files...`);
  for (const [relPath, content] of Object.entries(result.files || {})) {
    fs.writeFileSync(path.join(projectDir, relPath), content);
  }

  console.log('[3/4] Running build validation...');
  let buildOk = true;
  try {
    execSync('npx tsc --noEmit', { cwd: projectDir, stdio: 'pipe' });
    execSync('npx expo export -p web', { cwd: projectDir, stdio: 'pipe' });
  } catch (err) {
    buildOk = false;
    console.error('  build failed:', err.stdout?.toString().slice(-2000) || err.message);
  }

  function rollback(reason) {
    gitRun('git checkout -- .', projectDir);
    gitRun('git clean -fd -- src', projectDir); // remove any new untracked files under src/
    const message = `수정을 적용하다가 ${reason} 이전 상태로 되돌렸습니다. 다른 방식으로 다시 요청해보세요.`;
    if (asJson) {
      console.log('RESULT_JSON:' + JSON.stringify({ type: 'rolled_back', message }));
    } else {
      console.log(message);
    }
  }

  if (!buildOk) {
    console.log('[4/4] Build failed - rolling back to last known-good commit...');
    rollback('빌드가 깨져서');
    return;
  }

  // Deterministic schema migration - the system computes this, not the AI.
  // Guard against the AI re-proposing a field that's already in the spec
  // (it's given the current spec as context but can still miss this) -
  // `add column if not exists` already makes the DB side idempotent, but
  // the spec.json array has no such protection on its own.
  const fieldAlreadyExists =
    result.fieldDelta && spec.resource.fields.some((f) => f.name === result.fieldDelta.name);
  if (result.requestType === 'ADD_FIELD' && result.fieldDelta && !fieldAlreadyExists) {
    console.log('[4/4] Applying deterministic ADD COLUMN migration...');
    const prefixedTable = `${slug.replace(/-/g, '_')}__${spec.resource.table}`;
    try {
      await applyFieldMigration(prefixedTable, result.fieldDelta);
    } catch (err) {
      // Migration failed AFTER the code files were already written and
      // validated - without this, the code and DB would end up
      // inconsistent (fields referenced in code that don't exist in the
      // DB), which is exactly what happened before this fix was added.
      console.log('[4/4] Migration failed - rolling back code changes too (DB was never touched)...');
      console.error('  ', err.message);
      rollback('DB 마이그레이션이 실패해서');
      return;
    }
    spec.resource.fields.push(result.fieldDelta);
    fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
  } else if (fieldAlreadyExists) {
    console.log(`[4/4] Field "${result.fieldDelta.name}" already existed in the spec - skipped duplicate.`);
  } else {
    console.log('[4/4] No schema change needed.');
  }

  gitRun('git add -A', projectDir);
  gitRun(
    `git -c user.email=bot@appbuilder.local -c user.name="App Builder Bot" commit -q -m ${JSON.stringify('Modification: ' + request)}`,
    projectDir
  );

  const note = result.note || '수정이 적용됐습니다.';
  if (asJson) {
    console.log('RESULT_JSON:' + JSON.stringify({ type: 'applied', note, requestType: result.requestType }));
  } else {
    console.log(`완료: ${note}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
