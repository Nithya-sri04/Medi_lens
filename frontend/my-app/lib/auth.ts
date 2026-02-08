const TOKEN_KEY = 'medilens_token';
const USER_KEY = 'medilens_user';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuth(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function setUser(user: { id: string; name: string; email: string }): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getUser(): { id: string; name: string; email: string } | null {
  if (typeof window === 'undefined') return null;
  const s = localStorage.getItem(USER_KEY);
  if (!s) return null;
  try {
    return JSON.parse(s) as { id: string; name: string; email: string };
  } catch {
    return null;
  }
}

export function isLoggedIn(): boolean {
  return !!getToken();
}
