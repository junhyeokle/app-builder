'use client';

import Link from 'next/link';
import { useState } from 'react';

type Project = { id: string; slug: string; app_name: string | null; status: string };

export function ProjectList({ initialProjects }: { initialProjects: Project[] }) {
  const [projects, setProjects] = useState(initialProjects);

  async function handleDelete(e: React.MouseEvent, slug: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('이 프로젝트를 삭제할까요? 생성된 결과물도 함께 삭제됩니다.')) return;

    await fetch(`/api/projects/${slug}`, { method: 'DELETE' });
    setProjects((ps) => ps.filter((p) => p.slug !== slug));
  }

  if (projects.length === 0) {
    return <p className="text-sm text-gray-500">아직 프로젝트가 없습니다. &quot;새 프로젝트&quot;로 시작해보세요.</p>;
  }

  return (
    <ul className="space-y-2">
      {projects.map((p) => (
        <li key={p.id} className="relative">
          <Link href={`/projects/${p.slug}`} className="block rounded border p-4 pr-16 hover:bg-gray-50">
            <div className="font-medium">{p.app_name || p.slug}</div>
            <div className="text-sm text-gray-500">{p.status}</div>
          </Link>
          <button
            onClick={(e) => handleDelete(e, p.slug)}
            className="absolute top-4 right-4 text-sm text-red-500 underline"
          >
            삭제
          </button>
        </li>
      ))}
    </ul>
  );
}
