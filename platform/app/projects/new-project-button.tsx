'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function NewProjectButton() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  async function handleClick() {
    const name = window.prompt('프로젝트 이름을 입력해주세요 (나중에 바꿀 수 없어요)');
    if (name === null) return; // user cancelled

    setCreating(true);
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() || undefined }),
    });
    const project = await res.json();
    setCreating(false);
    if (project.slug) router.push(`/projects/${project.slug}`);
  }

  return (
    <button
      onClick={handleClick}
      disabled={creating}
      className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
    >
      {creating ? '생성 중...' : '새 프로젝트'}
    </button>
  );
}
