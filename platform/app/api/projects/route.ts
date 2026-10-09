import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

function randomSlug() {
  return 'proj-' + Math.random().toString(36).slice(2, 8);
}

export async function POST() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const slug = randomSlug();
  const { data, error } = await supabase
    .from('platform_projects')
    .insert({ user_id: userData.user.id, slug, status: 'chatting' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('platform_projects')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
