// M2: feed a hardcoded structured spec to Gemini, have it fill the app-specific
// slots (data layer + main screen + SQL schema) into a copy of the M1 scaffold,
// then build-validate the result. No chat/requirement-analysis yet (that's M3).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const SCAFFOLD_DIR = path.join(ROOT, 'app-template');
// Generated projects are user content, not platform source - they must live
// outside this repo entirely (see MILESTONES.md M5 5-1: EAS Build silently
// drops anything inside a path excluded by .gitignore when the project sits
// inside a git repo, which generator/generated-projects/ was).
const OUT_BASE = process.env.GENERATED_PROJECTS_DIR || path.join(ROOT, '..', 'app-builder-generated-projects');

// Files that are app-specific in the scaffold and must NOT be copied verbatim;
// the AI generates replacements for these slots.
const SLOT_FILES_TO_SKIP = new Set([
  'src/lib/todos.ts',
  'src/app/index.tsx',
  'supabase/schema.sql',
]);

const SKIP_DIRS = new Set(['node_modules', '.expo', 'dist', '.git']);

function copyScaffold(destDir) {
  fs.mkdirSync(destDir, { recursive: true });

  function walk(relDir) {
    const srcDir = path.join(SCAFFOLD_DIR, relDir);
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const relPath = path.join(relDir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(relPath);
        continue;
      }
      if (entry.name === '.env') continue; // copied separately
      const posixRel = relPath.split(path.sep).join('/');
      if (SLOT_FILES_TO_SKIP.has(posixRel)) continue;

      const destPath = path.join(destDir, relPath);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(path.join(SCAFFOLD_DIR, relPath), destPath);
    }
  }
  walk('.');

  // Reuse the already-installed scaffold deps instead of a fresh npm install.
  fs.cpSync(path.join(SCAFFOLD_DIR, 'node_modules'), path.join(destDir, 'node_modules'), {
    recursive: true,
  });
  fs.copyFileSync(path.join(SCAFFOLD_DIR, '.env'), path.join(destDir, '.env'));
}

function buildPrompt(spec, referenceLib, referenceScreen, referenceSql) {
  return `You are generating three files for a React Native (Expo Router) + Supabase app, by following an EXISTING established pattern exactly (same imports, same themed components, same code style, same auth/data conventions). Do not introduce new UI libraries or change the project structure.

Here is the EXISTING reference data-layer file (src/lib/todos.ts) for a Todo resource - follow this exact pattern for the new resource:
---REFERENCE src/lib/todos.ts---
${referenceLib}
---END REFERENCE---

Here is the EXISTING reference screen file (src/app/index.tsx) for the Todo list - follow this exact layout/style pattern for the new screen:
---REFERENCE src/app/index.tsx---
${referenceScreen}
---END REFERENCE---

Here is the EXISTING reference SQL schema (supabase/schema.sql) for the todos table - follow this exact pattern (RLS policies etc.) for the new table:
---REFERENCE supabase/schema.sql---
${referenceSql}
---END REFERENCE---

Now generate the equivalent three files for this new app spec:
${JSON.stringify(spec, null, 2)}

Requirements:
- The data-layer file must export a TypeScript type named "${spec.resource.tsTypeName}" and list/create/update/delete functions analogous to listTodos/createTodo/toggleTodo/deleteTodo, but for table "${spec.resource.table}" with fields: ${spec.resource.fields.map((f) => `${f.name} (${f.tsType})`).join(', ')}.
- The screen file implements: ${spec.screen.description}
- The SQL file creates table "${spec.resource.table}" with the same RLS pattern (user_id ownership, 4 policies: select/insert/update/delete).
- CRITICAL: the ONLY valid values for ThemedText's "type" prop are exactly: default, title, small, smallBold, subtitle, link, linkPrimary, code. This is NOT the stock Expo template's ThemedText (which has different type names like "defaultSemiBold") - it is a custom component local to this project. Using any type value other than the ones listed above will fail TypeScript compilation. When in doubt, omit the "type" prop entirely rather than guessing one.
- Use the exact same import alias style ("@/lib/...", "@/components/...", "@/contexts/auth-context", "@/constants/theme").

Respond with EXACTLY this format, nothing else (no markdown fences, no commentary):

===FILE: src/lib/${spec.resource.libFileName}.ts===
<full file content>
===FILE: src/app/index.tsx===
<full file content>
===FILE: supabase/schema.sql===
<full file content>
`;
}

// V0.1 multi-tenant isolation: all generated apps share one Supabase project
// (see MILESTONES.md M4). To avoid table-name collisions between apps without
// needing Supabase's "exposed schemas" admin config, every generated table is
// prefixed with the project slug and kept in the public schema.
function prefixedTableName(spec) {
  return `${spec.slug.replace(/-/g, '_')}__${spec.resource.table}`;
}

function applyTablePrefix(content, originalTable, prefixedTable) {
  const pattern = new RegExp(`\\b${originalTable}\\b`, 'g');
  return content.replace(pattern, prefixedTable);
}

async function applySchema(sql) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

function parseResponse(text) {
  const parts = text.split(/===FILE: (.+?)===/g).slice(1);
  const files = {};
  for (let i = 0; i < parts.length; i += 2) {
    const filePath = parts[i].trim();
    const content = parts[i + 1].replace(/^\n/, '').replace(/\n$/, '\n');
    files[filePath] = content;
  }
  return files;
}

async function main() {
  const specName = process.argv[2];
  if (!specName) {
    console.error('Usage: node generate.js <spec-name>  (e.g. shopping-list)');
    process.exit(1);
  }

  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'specs', `${specName}.json`), 'utf8'));
  const referenceLib = fs.readFileSync(path.join(SCAFFOLD_DIR, 'src/lib/todos.ts'), 'utf8');
  const referenceScreen = fs.readFileSync(path.join(SCAFFOLD_DIR, 'src/app/index.tsx'), 'utf8');
  const referenceSql = fs.readFileSync(path.join(SCAFFOLD_DIR, 'supabase/schema.sql'), 'utf8');

  console.log(`[1/5] Calling Gemini to generate "${spec.appName}"...`);
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });
  const prompt = buildPrompt(spec, referenceLib, referenceScreen, referenceSql);

  let result;
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      result = await model.generateContent(prompt);
      break;
    } catch (err) {
      const retryable = err?.status === 503 || err?.status === 429;
      if (!retryable || attempt === maxAttempts) throw err;
      const waitMs = attempt * 5000;
      console.log(`  Gemini busy (status ${err.status}), retrying in ${waitMs / 1000}s... (${attempt}/${maxAttempts})`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  const text = result.response.text();

  const files = parseResponse(text);
  const expectedKeys = [`src/lib/${spec.resource.libFileName}.ts`, 'src/app/index.tsx', 'supabase/schema.sql'];
  for (const key of expectedKeys) {
    if (!files[key]) {
      console.error('Model response missing expected file:', key);
      console.error('--- raw response ---');
      console.error(text);
      process.exit(1);
    }
  }

  const prefixedTable = prefixedTableName(spec);
  for (const key of ['supabase/schema.sql', 'src/lib/' + spec.resource.libFileName + '.ts']) {
    files[key] = applyTablePrefix(files[key], spec.resource.table, prefixedTable);
  }

  const destDir = path.join(OUT_BASE, spec.slug);
  console.log(`[2/5] Assembling project at ${path.relative(ROOT, destDir)}...`);
  fs.rmSync(destDir, { recursive: true, force: true });
  copyScaffold(destDir);

  for (const [relPath, content] of Object.entries(files)) {
    const destPath = path.join(destDir, relPath);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, content);
    console.log(`  wrote ${relPath} (${content.length} bytes)`);
  }

  console.log(`[3/5] Applying schema to Supabase (table: ${prefixedTable})...`);
  try {
    await applySchema(files['supabase/schema.sql']);
    console.log('  schema applied.');
  } catch (err) {
    console.error('SCHEMA APPLY FAILED:', err.message);
    process.exit(1);
  }

  console.log('[4/5] Running build validation (tsc --noEmit)...');
  try {
    execSync('npx tsc --noEmit', { cwd: destDir, stdio: 'inherit' });
  } catch {
    console.error('BUILD VALIDATION FAILED: TypeScript errors above.');
    process.exit(1);
  }

  console.log('[5/5] Running build validation (expo export -p web)...');
  try {
    // The platform serves this static export under /preview/<slug>/, not
    // site root, so asset/route URLs must be prefixed accordingly or every
    // request 404s and the app never loads (blank iframe) - see MILESTONES.md.
    // This is controlled by app.json's expo.experiments.baseUrl, NOT an env
    // var (EXPO_BASE_URL only affects expo-router's client-side route
    // matching, not the asset URLs Metro writes into index.html).
    const appJsonPath = path.join(destDir, 'app.json');
    const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
    appJson.expo.experiments = { ...appJson.expo.experiments, baseUrl: `/preview/${spec.slug}` };
    fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2));

    execSync('npx expo export -p web', { cwd: destDir, stdio: 'inherit' });
  } catch {
    console.error('BUILD VALIDATION FAILED: web export errors above.');
    process.exit(1);
  }

  console.log(`\nSUCCESS. Generated project at: ${destDir}`);
  console.log(`Schema already applied to Supabase as table "${prefixedTable}" — no manual SQL step needed.`);
  console.log(`Preview: cd ${path.relative(ROOT, destDir)} && npx expo start --web`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
