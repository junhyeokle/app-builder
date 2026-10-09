// Runs build-apk.js's buildApk() and writes the result into the platform's
// platform_projects row, so the Next.js UI (which only has synchronous HTTP
// requests) can poll the DB instead of holding open a 10+ minute connection.
// Meant to be spawned detached by the platform's /api/projects/[slug]/apk route.

require('dotenv').config();
const { Client } = require('pg');
const { buildApk } = require('./build-apk');

async function setStatus(slug, fields) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const sets = Object.keys(fields)
      .map((k, i) => `${k} = $${i + 2}`)
      .join(', ');
    await client.query(
      `update public.platform_projects set ${sets}, updated_at = now() where slug = $1`,
      [slug, ...Object.values(fields)]
    );
  } finally {
    await client.end();
  }
}

async function main() {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: node build-apk-and-record.js <slug>');
    process.exit(1);
  }

  await setStatus(slug, { status: 'building_apk' });
  try {
    const apkUrl = await buildApk(slug);
    await setStatus(slug, { status: 'ready_with_apk', apk_url: apkUrl });
  } catch (err) {
    console.error(err);
    await setStatus(slug, { status: 'apk_failed' });
    process.exit(1);
  }
}

main();
