import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { createClient } from '@/lib/supabase/server';

const PROJECTS_BASE =
  process.env.GENERATED_PROJECTS_DIR || path.join(process.cwd(), '..', 'app-builder-generated-projects');

export async function DELETE(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  // RLS (user_id = auth.uid()) ensures this only deletes the caller's own project.
  const { error } = await supabase.from('platform_projects').delete().eq('slug', slug);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const projectDir = path.join(PROJECTS_BASE, slug);
  if (fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }

  return NextResponse.json({ ok: true });
}
