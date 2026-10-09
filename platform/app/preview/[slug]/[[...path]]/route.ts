import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Serves the static `dist/` output that generate.js already produces as
// part of its build-validation step (see MILESTONES.md M5 5-3: "approach B" -
// show the already-built snapshot instead of running a live dev server).
const PROJECTS_BASE =
  process.env.GENERATED_PROJECTS_DIR || path.join(process.cwd(), '..', '..', 'app-builder-generated-projects');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; path?: string[] }> }) {
  const { slug, path: subPath } = await params;
  const distDir = path.join(PROJECTS_BASE, slug, 'dist');

  if (!fs.existsSync(distDir)) {
    return NextResponse.json({ error: 'No preview build found for this project yet' }, { status: 404 });
  }

  const relPath = subPath && subPath.length > 0 ? subPath.join('/') : 'index.html';
  const filePath = path.join(distDir, relPath);

  // Prevent escaping the dist directory.
  if (!filePath.startsWith(distDir)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // Expo Router's static export is a single-page app; unknown sub-paths
    // fall back to index.html so client-side routing can take over.
    const indexPath = path.join(distDir, 'index.html');
    const content = fs.readFileSync(indexPath);
    return new NextResponse(content, { headers: { 'Content-Type': 'text/html' } });
  }

  const content = fs.readFileSync(filePath);
  const ext = path.extname(filePath);
  return new NextResponse(content, {
    headers: { 'Content-Type': CONTENT_TYPES[ext] || 'application/octet-stream' },
  });
}
