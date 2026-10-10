'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { translateAuthError } from '@/lib/auth-messages';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    const supabase = createClient();
    const result =
      mode === 'signIn'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setSubmitting(false);

    if (result.error) {
      setError(translateAuthError(result.error.message));
      return;
    }

    if (mode === 'signUp' && !result.data.session) {
      // Email confirmation is required - there's no active session yet, so
      // redirecting to /projects would just bounce back to /login looking
      // like nothing happened (see PROBLEM.md #1).
      setNotice('인증 이메일을 보냈습니다. 메일함에서 인증 후 로그인해주세요. (이미 가입된 이메일이어도 같은 안내가 나옵니다.)');
      setPassword('');
      setMode('signIn');
      return;
    }

    router.push('/projects');
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-lg border bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold">App Builder</h1>
        <p className="text-sm text-gray-500">{mode === 'signIn' ? '로그인' : '회원가입'}</p>

        <input
          type="email"
          placeholder="이메일"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full rounded border px-3 py-2 text-sm"
        />
        <input
          type="password"
          placeholder="비밀번호"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full rounded border px-3 py-2 text-sm"
        />

        {error && <p className="text-sm text-red-600">{error}</p>}
        {notice && <p className="text-sm text-green-700">{notice}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitting ? '처리 중...' : mode === 'signIn' ? '로그인' : '가입하기'}
        </button>

        <button
          type="button"
          onClick={() => {
            setMode(mode === 'signIn' ? 'signUp' : 'signIn');
            setError(null);
            setNotice(null);
          }}
          className="w-full text-center text-sm text-gray-500 underline"
        >
          {mode === 'signIn' ? '계정이 없으신가요? 가입하기' : '이미 계정이 있으신가요? 로그인'}
        </button>
      </form>
    </div>
  );
}
