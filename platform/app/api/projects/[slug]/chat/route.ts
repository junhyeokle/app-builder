import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import path from 'path';
import { createClient } from '@/lib/supabase/server';

const GENERATOR_DIR = path.join(process.cwd(), '..', 'generator');

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { message } = await request.json();

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: project } = await supabase.from('platform_projects').select('*').eq('slug', slug).single();
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  // V0.1 has no post-generation modification (see MILESTONES.md - deferred to
  // V0.2). Once a project has a finished spec, analyze.js's session for it is
  // gone, so further messages would be treated as a brand-new conversation
  // and silently restart from the generic opening question - confusing, not
  // a real feature. Refuse explicitly instead.
  const FINISHED_STATUSES = ['ready', 'failed', 'building_apk', 'ready_with_apk', 'apk_failed'];
  if (FINISHED_STATUSES.includes(project.status)) {
    return NextResponse.json({
      type: 'unsupported',
      message: '이 프로젝트는 이미 생성이 완료됐습니다. 지금 버전(V0.1)에서는 생성 후 수정 기능을 지원하지 않아요 — 바꾸고 싶은 부분이 있다면 새 프로젝트로 다시 설명해주세요.',
    });
  }

  let output: string;
  try {
    const escaped = message.replace(/"/g, '\\"');
    output = execSync(`node analyze.js ${slug} "${escaped}" --json`, {
      cwd: GENERATOR_DIR,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 50,
    });
  } catch (err) {
    const e = err as { stdout?: string; message: string };
    return NextResponse.json({ error: e.stdout || e.message }, { status: 500 });
  }

  const resultLine = output.split('\n').find((line) => line.startsWith('RESULT_JSON:'));
  if (!resultLine) return NextResponse.json({ error: 'No result from analyzer', raw: output }, { status: 500 });

  const result = JSON.parse(resultLine.slice('RESULT_JSON:'.length));

  if (result.type === 'question') {
    await supabase.from('platform_projects').update({ status: 'chatting' }).eq('slug', slug);
    return NextResponse.json({ type: 'question', question: result.question });
  }

  // type === 'spec'
  await supabase
    .from('platform_projects')
    .update({
      app_name: result.spec.appName,
      spec: result.spec,
      status: result.generateOk ? 'ready' : 'failed',
    })
    .eq('slug', slug);

  return NextResponse.json({
    type: 'spec',
    spec: result.spec,
    note: result.note,
    generateOk: result.generateOk,
  });
}
