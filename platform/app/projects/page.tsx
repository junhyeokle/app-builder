import { createClient } from '@/lib/supabase/server';
import { NewProjectButton } from './new-project-button';
import { ProjectList } from './project-list';
import { LogoutButton } from './logout-button';

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
        <div className="flex items-center gap-4">
          <NewProjectButton />
          <LogoutButton />
        </div>
      </div>

      <ProjectList initialProjects={projects ?? []} />
    </div>
  );
}
