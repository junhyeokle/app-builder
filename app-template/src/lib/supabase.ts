import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env and fill in your Supabase project credentials.'
  );
}

// All generated apps currently share one Supabase project (see
// MILESTONES.md M4/M5). Without a per-project storage key, every app's auth
// session would be stored under the same key - and since the platform
// serves every preview from the same browser origin (localhost:3000), that
// meant logging into one generated app silently logged you into every
// other one too (see PROBLEM.md #3, batch 6). EXPO_PUBLIC_PROJECT_SLUG is
// injected per-project by generate.js precisely so each app's session is
// isolated from every other app's, not just from other users.
const projectSlug = process.env.EXPO_PUBLIC_PROJECT_SLUG || 'app-template';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    storageKey: `sb-${projectSlug}-auth-token`,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
