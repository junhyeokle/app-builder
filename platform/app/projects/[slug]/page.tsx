import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ProjectWorkspace } from './project-workspace';

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: project } = await supabase.from('platform_projects').select('*').eq('slug', slug).single();

  if (!project) notFound();

  return <ProjectWorkspace initialProject={project} />;
}
