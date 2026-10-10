'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type ChatMessage = { role: 'user' | 'ai'; text: string };

type Project = {
  slug: string;
  app_name: string | null;
  status: string;
  apk_url: string | null;
  spec: unknown;
  messages: ChatMessage[];
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  chatting: { label: '요구사항 확인 중', className: 'bg-gray-100 text-gray-600' },
  generating: { label: '생성 중...', className: 'bg-blue-100 text-blue-700' },
  ready: { label: '✅ 빌드 완료', className: 'bg-green-100 text-green-700' },
  failed: { label: '❌ 생성 실패', className: 'bg-red-100 text-red-700' },
  building_apk: { label: 'APK 빌드 중... (몇 분 걸려요)', className: 'bg-blue-100 text-blue-700' },
  ready_with_apk: { label: '✅ APK 준비 완료', className: 'bg-green-100 text-green-700' },
  apk_failed: { label: '❌ APK 빌드 실패', className: 'bg-red-100 text-red-700' },
};

function StatusBadge({ status }: { status: string }) {
  const info = STATUS_LABELS[status] ?? { label: status, className: 'bg-gray-100 text-gray-600' };
  return <span className={`rounded px-2 py-1 text-xs font-medium ${info.className}`}>{info.label}</span>;
}

export function ProjectWorkspace({ initialProject }: { initialProject: Project }) {
  const [project, setProject] = useState(initialProject);
  const [messages, setMessages] = useState<ChatMessage[]>(initialProject.messages ?? []);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [buildingApk, setBuildingApk] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // While an APK build is running, poll this project's row for completion
  // (build-apk-and-record.js writes status/apk_url directly to the DB once
  // the EAS build finishes - this request can't stay open that long).
  useEffect(() => {
    if (!buildingApk) return;
    const supabase = createClient();
    const interval = setInterval(async () => {
      const { data } = await supabase.from('platform_projects').select('*').eq('slug', project.slug).single();
      if (data && data.status !== 'building_apk') {
        setProject(data);
        setBuildingApk(false);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [buildingApk, project.slug]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || busy) return;
    setMessages((m) => [...m, { role: 'user', text }]);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setBusy(true);
    setProject((p) => ({ ...p, status: 'generating' }));

    const res = await fetch(`/api/projects/${project.slug}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    const result = await res.json();
    setBusy(false);

    if (result.type === 'question') {
      setMessages((m) => [...m, { role: 'ai', text: result.question }]);
      setProject((p) => ({ ...p, status: 'chatting' }));
    } else if (result.type === 'spec') {
      setMessages((m) => [
        ...m,
        { role: 'ai', text: result.note || (result.generateOk ? '앱이 생성됐습니다.' : '생성 중 오류가 발생했습니다.') },
      ]);
      setProject((p) => ({ ...p, app_name: result.appName ?? result.spec.appName, status: result.generateOk ? 'ready' : 'failed' }));
    } else if (result.type === 'unsupported') {
      setMessages((m) => [...m, { role: 'ai', text: result.message }]);
    } else if (result.error) {
      setMessages((m) => [...m, { role: 'ai', text: `오류: ${result.error}` }]);
    }
  }

  async function requestApk() {
    setBuildingApk(true);
    setProject((p) => ({ ...p, status: 'building_apk' }));
    await fetch(`/api/projects/${project.slug}/apk`, { method: 'POST' });
  }

  const isReady = project.status === 'ready' || project.status === 'ready_with_apk';
  // V0.1 has no post-generation modification (see MILESTONES.md, V0.2 item).
  // Once generation has finished (successfully or not), lock the chat input
  // instead of letting the user keep typing into a conversation that no
  // longer exists server-side.
  const isFinished = ['ready', 'failed', 'building_apk', 'ready_with_apk', 'apk_failed'].includes(project.status);

  return (
    <div className="mx-auto flex h-screen max-w-5xl gap-4 p-4">
      <div className="flex w-1/2 flex-col rounded border">
        <div className="flex items-center gap-2 border-b p-3 font-medium">
          <Link href="/projects" className="text-sm text-gray-400 hover:text-gray-600">
            ← 내 프로젝트
          </Link>
          <span>{project.app_name || project.slug}</span>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
              <span
                className={
                  'inline-block max-w-[80%] rounded px-3 py-2 text-sm ' +
                  (m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900')
                }
              >
                {m.text}
              </span>
            </div>
          ))}
          {busy && <div className="text-sm text-gray-400">생성 중...</div>}
          <div ref={bottomRef} />
        </div>
        {isFinished && (
          <div className="border-t bg-amber-50 p-3 text-sm text-amber-800">
            이 프로젝트는 생성이 끝났습니다. 지금 버전에서는 수정 기능이 없어요 — 바꾸고 싶으면 새 프로젝트로 다시 설명해주세요.
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage();
          }}
          className="flex gap-2 border-t p-3"
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="만들고 싶은 앱을 설명해주세요... (Shift+Enter로 줄바꿈)"
            rows={1}
            className="max-h-40 flex-1 resize-none overflow-y-auto rounded border px-3 py-2 text-sm"
            style={{ height: 'auto' }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
            }}
            disabled={busy || isFinished}
          />
          <button
            type="submit"
            disabled={busy || isFinished}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            전송
          </button>
        </form>
      </div>

      <div className="flex w-1/2 flex-col rounded border">
        <div className="flex items-center justify-between border-b p-3">
          <div className="flex items-center gap-2">
            <span className="font-medium">프리뷰</span>
            <StatusBadge status={project.status} />
          </div>
          {isReady && (
            <button
              onClick={requestApk}
              disabled={buildingApk}
              className="rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {buildingApk ? 'APK 빌드 중...' : project.apk_url ? 'APK 다시 받기' : 'APK 다운로드'}
            </button>
          )}
        </div>

        {project.apk_url && (
          <a
            href={project.apk_url}
            className="m-3 block rounded bg-green-50 p-2 text-center text-sm text-green-700 underline"
          >
            APK 다운로드: {project.apk_url}
          </a>
        )}

        <div className="flex-1">
          {isReady ? (
            <iframe src={`/preview/${project.slug}`} className="h-full w-full border-0" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">
              {project.status === 'generating'
                ? '코드 생성 + 빌드 검증 중입니다 (몇십 초 정도 걸려요)...'
                : project.status === 'failed'
                ? '생성에 실패했습니다. 왼쪽 채팅 메시지를 확인해주세요.'
                : '앱이 생성되면 여기에 프리뷰가 표시됩니다.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
