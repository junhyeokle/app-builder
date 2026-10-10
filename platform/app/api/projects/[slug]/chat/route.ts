import { NextResponse } from 'next/server';
import { execSync } from 'child_process';
import path from 'path';
import { createClient } from '@/lib/supabase/server';

const GENERATOR_DIR = path.join(process.cwd(), '..', 'generator');

type ChatMsg = { role: 'user' | 'ai'; text: string };

function runGeneratorScript(script: string, slug: string, message: string): Record<string, unknown> {
  const escaped = message.replace(/"/g, '\\"');
  const output = execSync(`node ${script} ${slug} "${escaped}" --json`, {
    cwd: GENERATOR_DIR,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 50,
  });
  const resultLine = output.split('\n').find((line) => line.startsWith('RESULT_JSON:'));
  if (!resultLine) throw new Error('No RESULT_JSON from ' + script + ':\n' + output);
  return JSON.parse(resultLine.slice('RESULT_JSON:'.length));
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { message } = await request.json();

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: project } = await supabase.from('platform_projects').select('*').eq('slug', slug).single();
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const existingMessages = (project.messages ?? []) as ChatMsg[];

  // V0.2: a finished project can now be modified (generator/modify.js),
  // not just the initial generation (generator/analyze.js). Projects mid-APK
  // build or that failed generation entirely have no safe target to modify.
  const MODIFIABLE_STATUSES = ['ready', 'ready_with_apk'];
  const BLOCKED_STATUSES = ['failed', 'building_apk', 'apk_failed'];

  if (BLOCKED_STATUSES.includes(project.status)) {
    return NextResponse.json({
      type: 'unsupported',
      message:
        project.status === 'failed'
          ? '이 프로젝트는 생성에 실패해서 수정할 대상이 없습니다. 새 프로젝트로 다시 시도해주세요.'
          : 'APK 빌드가 진행 중이라 지금은 수정할 수 없습니다. 빌드가 끝난 후 다시 시도해주세요.',
    });
  }

  try {
    if (MODIFIABLE_STATUSES.includes(project.status)) {
      const result = runGeneratorScript('modify.js', slug, message);
      const messages: ChatMsg[] = [...existingMessages, { role: 'user', text: message }];

      if (result.type === 'declined') {
        messages.push({ role: 'ai', text: result.reason as string });
        await supabase.from('platform_projects').update({ messages }).eq('slug', slug);
        return NextResponse.json({ type: 'declined', message: result.reason });
      }
      if (result.type === 'rolled_back') {
        messages.push({ role: 'ai', text: result.message as string });
        await supabase.from('platform_projects').update({ messages }).eq('slug', slug);
        return NextResponse.json({ type: 'rolled_back', message: result.message });
      }
      // type === 'applied'
      messages.push({ role: 'ai', text: result.note as string });
      // Bump the preview's cache-busting token so the iframe reloads the
      // freshly rebuilt static export instead of a stale cached version.
      const previewVersion = (project.preview_version ?? 0) + 1;
      await supabase.from('platform_projects').update({ messages, preview_version: previewVersion }).eq('slug', slug);
      return NextResponse.json({ type: 'modified', note: result.note, previewVersion });
    }

    // Not yet generated - normal requirement-analysis flow.
    const result = runGeneratorScript('analyze.js', slug, message);

    if (result.type === 'question') {
      const messages: ChatMsg[] = [...existingMessages, { role: 'user', text: message }, { role: 'ai', text: result.question as string }];
      await supabase.from('platform_projects').update({ status: 'chatting', messages }).eq('slug', slug);
      return NextResponse.json({ type: 'question', question: result.question });
    }

    // type === 'spec'
    const spec = result.spec as { appName: string };
    const generateOk = result.generateOk as boolean;
    const aiText = (result.note as string) || (generateOk ? '앱이 생성됐습니다.' : '생성 중 오류가 발생했습니다.');
    const messages: ChatMsg[] = [...existingMessages, { role: 'user', text: message }, { role: 'ai', text: aiText }];
    // Don't clobber a name the user picked at project creation (see PROBLEM.md
    // #2 "새 프로젝트" naming) - only fall back to the AI's name if none was set.
    const appName = project.app_name || spec.appName;
    await supabase
      .from('platform_projects')
      .update({ app_name: appName, spec, status: generateOk ? 'ready' : 'failed', messages })
      .eq('slug', slug);

    return NextResponse.json({ type: 'spec', spec, appName, note: result.note, generateOk });
  } catch (err) {
    const e = err as { stdout?: string; message: string };
    return NextResponse.json({ error: e.stdout || e.message }, { status: 500 });
  }
}
