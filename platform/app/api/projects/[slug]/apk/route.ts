import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import { createClient } from '@/lib/supabase/server';

const GENERATOR_DIR = path.join(process.cwd(), '..', 'generator');

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: project } = await supabase.from('platform_projects').select('*').eq('slug', slug).single();
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  // Build takes several minutes - fire-and-forget. build-apk-and-record.js
  // writes the result (status + apk_url) back to this project's row itself
  // once done, since it can't own this HTTP response that long.
  const child = spawn('node', ['build-apk-and-record.js', slug], {
    cwd: GENERATOR_DIR,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  await supabase.from('platform_projects').update({ status: 'building_apk' }).eq('slug', slug);

  return NextResponse.json({ status: 'building_apk' });
}
