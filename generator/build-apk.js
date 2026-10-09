// M5 (5-1): turn a generated project into a downloadable APK, on demand.
// This is a SEPARATE step from generate.js/analyze.js on purpose - the user
// reviews the preview first and only triggers this once satisfied, so we
// don't burn EAS Build minutes/quota on every iteration.
//
// Usage: node build-apk.js <spec-slug>   (the project must already exist in
// generated-projects/<slug>, i.e. generate.js has already run for it)

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EAS_JSON = fs.readFileSync(path.join(ROOT, 'app-template', 'eas.json'), 'utf8');

function readEnvFile(envPath) {
  const content = fs.readFileSync(envPath, 'utf8');
  const vars = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) vars[match[1]] = match[2];
  }
  return vars;
}

function run(cmd, cwd) {
  return execSync(cmd, { cwd, stdio: 'inherit' });
}

function runJson(cmd, cwd) {
  const out = execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'inherit'] });
  return JSON.parse(out.toString());
}

async function buildApk(slug) {
  const projectsBase = process.env.GENERATED_PROJECTS_DIR || path.join(ROOT, '..', 'app-builder-generated-projects');
  const projectDir = path.join(projectsBase, slug);
  if (!fs.existsSync(projectDir)) {
    console.error(`No generated project at ${projectDir}. Run generate.js first.`);
    process.exit(1);
  }

  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'specs', `${slug}.json`), 'utf8'));
  const packageName = `com.appbuilder.${slug.replace(/-/g, '_')}`;

  console.log(`[1/5] Configuring app identity (package: ${packageName})...`);
  const appJsonPath = path.join(projectDir, 'app.json');
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  appJson.expo.name = spec.appName;
  appJson.expo.slug = slug;
  appJson.expo.android = { ...appJson.expo.android, package: packageName };
  delete appJson.expo.extra?.eas; // stale projectId copied from the scaffold; eas init below re-creates it
  delete appJson.expo.owner;
  fs.writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2));
  fs.writeFileSync(path.join(projectDir, 'eas.json'), EAS_JSON);

  // EAS Build requires the project to be a git repo (it uses git to compute
  // the build fingerprint). This is a throwaway local repo just to satisfy
  // that requirement - it has nothing to do with the platform's own repo.
  console.log('[1b/5] Ensuring project has a local git repo (required by EAS Build)...');
  if (!fs.existsSync(path.join(projectDir, '.git'))) {
    run('git init -q', projectDir);
  }
  run('git add -A', projectDir);
  const hasChanges = execSync('git status --porcelain', { cwd: projectDir }).toString().trim().length > 0;
  if (hasChanges) {
    run('git -c user.email=bot@appbuilder.local -c user.name="App Builder Bot" commit -q -m "Generated project"', projectDir);
  }

  console.log('[2/5] Registering project with EAS...');
  run(`npx eas-cli init --account ${process.env.EAS_ACCOUNT} --force --non-interactive`, projectDir);

  console.log('[3/5] Pushing Supabase config to EAS (preview environment)...');
  const envVars = readEnvFile(path.join(projectDir, '.env'));
  for (const name of ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY']) {
    run(
      `npx eas-cli env:create preview --name ${name} --value "${envVars[name]}" --visibility plaintext --force --non-interactive`,
      projectDir
    );
  }

  console.log('[4/5] Triggering EAS build (android, preview profile)...');
  const buildResult = runJson(
    'npx eas-cli build --platform android --profile preview --non-interactive --no-wait --json',
    projectDir
  );
  const build = Array.isArray(buildResult) ? buildResult[0] : buildResult;
  const buildId = build.id;
  console.log(`  build queued: ${buildId}`);

  console.log('[5/5] Waiting for build to finish (this can take several minutes)...');
  let status = build.status;
  let artifactUrl;
  while (!['FINISHED', 'ERRORED', 'CANCELED'].includes(status)) {
    await new Promise((r) => setTimeout(r, 30000));
    const info = runJson(`npx eas-cli build:view ${buildId} --json`, projectDir);
    status = info.status;
    artifactUrl = info.artifacts?.buildUrl;
    console.log(`  ${new Date().toLocaleTimeString()} status=${status}`);
  }

  if (status !== 'FINISHED') {
    throw new Error(
      `BUILD ${status}. See https://expo.dev/accounts/${process.env.EAS_ACCOUNT}/projects/${slug}/builds/${buildId}`
    );
  }

  console.log(`\nSUCCESS. APK: ${artifactUrl}`);
  return artifactUrl;
}

module.exports = { buildApk };

if (require.main === module) {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: node build-apk.js <spec-slug>  (e.g. shopping-list)');
    process.exit(1);
  }
  buildApk(slug).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
