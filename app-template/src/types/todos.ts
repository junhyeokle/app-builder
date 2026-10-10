export type Todo = {
  id: string;
  user_id: string;
  title: string;
  is_done: boolean;
  due_date: string | null;
  created_at: string;
};
