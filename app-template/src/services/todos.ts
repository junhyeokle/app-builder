import { supabase } from '@/lib/supabase';
import type { Todo } from '@/types/todos';

export async function listTodos(): Promise<Todo[]> {
  const { data, error } = await supabase
    .from('todos')
    .select('*')
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function createTodo(title: string, dueDate: string | null): Promise<Todo> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('todos')
    .insert({ title, due_date: dueDate, user_id: userId })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function toggleTodo(id: string, isDone: boolean): Promise<void> {
  const { error } = await supabase.from('todos').update({ is_done: isDone }).eq('id', id);
  if (error) throw error;
}

export async function deleteTodo(id: string): Promise<void> {
  const { error } = await supabase.from('todos').delete().eq('id', id);
  if (error) throw error;
}
