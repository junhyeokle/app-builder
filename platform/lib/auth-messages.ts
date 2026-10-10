// Supabase Auth returns raw English error messages. Translate the ones we
// actually see; fall back to the original message for anything unmapped
// rather than hiding it (better an English string than a silent failure).
const KNOWN_ERRORS: Record<string, string> = {
  'Password should be at least 6 characters.': '비밀번호는 최소 6자 이상이어야 합니다.',
  'Invalid login credentials': '이메일 또는 비밀번호가 올바르지 않습니다.',
  'User already registered': '이미 가입된 이메일입니다.',
  'Email not confirmed': '이메일 인증이 필요합니다. 메일함을 확인해주세요.',
};

export function translateAuthError(message: string): string {
  return KNOWN_ERRORS[message] ?? message;
}
