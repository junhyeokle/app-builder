import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { NewProjectButton } from './new-project-button';

export default async function ProjectsPage() {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from('platform_projects')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">내 프로젝트</h1>
        <NewProjectButton />
      </div>

      <ul className="space-y-2">
        {(projects ?? []).map((p) => (
          <li key={p.id}>
            <Link href={`/projects/${p.slug}`} className="block rounded border p-4 hover:bg-gray-50">
              <div className="font-medium">{p.app_name || p.slug}</div>
              <div className="text-sm text-gray-500">{p.status}</div>
            </Link>
          </li>
        ))}
        {(!projects || projects.length === 0) && (
          <p className="text-sm text-gray-500">아직 프로젝트가 없습니다. &quot;새 프로젝트&quot;로 시작해보세요.</p>
        )}
      </ul>
    </div>
  );
}
