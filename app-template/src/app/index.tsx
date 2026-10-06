import { Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/contexts/auth-context';
import { createTodo, deleteTodo, listTodos, toggleTodo, type Todo } from '@/lib/todos';

export default function TodoListScreen() {
  const { session, isLoading, signOut } = useAuth();
  const [todos, setTodos] = useState<Todo[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setTodos(await listTodos());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load todos');
    }
  }, []);

  useEffect(() => {
    if (session) refresh();
  }, [session, refresh]);

  if (!isLoading && !session) {
    return <Redirect href="/login" />;
  }

  async function handleAdd() {
    const title = newTitle.trim();
    if (!title) return;
    setNewTitle('');
    await createTodo(title, null);
    refresh();
  }

  async function handleToggle(todo: Todo) {
    await toggleTodo(todo.id, !todo.is_done);
    refresh();
  }

  async function handleDelete(todo: Todo) {
    await deleteTodo(todo.id);
    refresh();
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedView style={styles.header}>
          <ThemedText type="title" style={styles.title}>
            Todo
          </ThemedText>
          <Pressable onPress={signOut}>
            <ThemedText type="linkPrimary">Log out</ThemedText>
          </Pressable>
        </ThemedView>

        <ThemedView style={styles.addRow}>
          <TextInput
            style={styles.input}
            placeholder="Add a todo..."
            value={newTitle}
            onChangeText={setNewTitle}
            onSubmitEditing={handleAdd}
          />
          <Pressable style={styles.addButton} onPress={handleAdd}>
            <ThemedText style={styles.addButtonText}>Add</ThemedText>
          </Pressable>
        </ThemedView>

        {loadError && <ThemedText style={styles.error}>{loadError}</ThemedText>}

        <FlatList
          data={todos}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <ThemedView type="backgroundElement" style={styles.todoRow}>
              <Pressable style={styles.todoMain} onPress={() => handleToggle(item)}>
                <ThemedText style={item.is_done ? styles.todoDone : undefined}>{item.title}</ThemedText>
              </Pressable>
              <Pressable onPress={() => handleDelete(item)}>
                <ThemedText themeColor="textSecondary">Delete</ThemedText>
              </Pressable>
            </ThemedView>
          )}
          ListEmptyComponent={<ThemedText themeColor="textSecondary">No todos yet.</ThemedText>}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center' },
  safeArea: {
    flex: 1,
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 28, lineHeight: 34 },
  addRow: { flexDirection: 'row', gap: Spacing.two },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#D0D0D5',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  addButton: {
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
  addButtonText: { color: '#fff', fontWeight: '600' },
  error: { color: '#D92D20' },
  list: { gap: Spacing.two },
  todoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: Spacing.two,
    padding: Spacing.three,
  },
  todoMain: { flex: 1 },
  todoDone: { textDecorationLine: 'line-through', opacity: 0.5 },
});
