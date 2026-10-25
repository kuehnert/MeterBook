// API-Client mit automatischer Token-Erneuerung.

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'USER';
  /** Eingeladen, Passwort noch nicht festgelegt */
  pending?: boolean;
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
  user: User;
}

const STORAGE_KEY = 'meterbook.session';

function loadSession(): Tokens | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Tokens) : null;
  } catch {
    return null;
  }
}

function saveSession(t: Tokens | null) {
  try {
    if (t) localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ohne Speicher bleibt die Sitzung nur bis zum Neuladen erhalten.
  }
}

let session: Tokens | null = loadSession();
const listeners = new Set<(u: User | null) => void>();

export function currentUser(): User | null {
  return session?.user ?? null;
}

export function onAuthChange(fn: (u: User | null) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function setSession(t: Tokens | null) {
  session = t;
  saveSession(t);
  listeners.forEach((l) => l(t?.user ?? null));
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = await res.json();
    const msg = Array.isArray(body.message) ? body.message.join(' · ') : body.message;
    return new ApiError(res.status, msg || res.statusText);
  } catch {
    return new ApiError(res.status, res.statusText || 'Unbekannter Fehler');
  }
}

let refreshing: Promise<boolean> | null = null;

async function refresh(): Promise<boolean> {
  if (!session) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session!.refreshToken }),
      });
      if (!res.ok) {
        setSession(null);
        return false;
      }
      setSession(await res.json());
      return true;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function raw(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const headers = new Headers(init.headers);
  if (session) headers.set('Authorization', `Bearer ${session.accessToken}`);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const res = await fetch(`/api${path}`, { ...init, headers });
  if (res.status === 401 && retry && session && (await refresh())) return raw(path, init, false);
  if (!res.ok) throw await parseError(res);
  return res;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await raw(path, init);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body ?? {}) });
export const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const del = (path: string) => api<void>(path, { method: 'DELETE' });

export async function blob(path: string): Promise<Blob> {
  return (await raw(path)).blob();
}

/** Lädt eine Datei mit Anmeldung herunter und bietet sie zum Speichern an. */
export async function download(path: string, fallbackName: string) {
  const res = await raw(path);
  const cd = res.headers.get('Content-Disposition') ?? '';
  const star = cd.match(/filename\*=UTF-8''([^;]+)/);
  const plain = cd.match(/filename="([^"]+)"/);
  const name = star ? decodeURIComponent(star[1]) : plain ? plain[1] : fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function login(email: string, password: string) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw await parseError(res);
  setSession(await res.json());
}

/** Aufruf ohne Anmeldung (Passwort vergessen, Link aus der E-Mail) */
export async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch('/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw await parseError(res);
  return res.status === 204 ? (undefined as T) : res.json();
}

/** Passwort über den Link aus Einladung oder „Passwort vergessen“ festlegen – meldet direkt an. */
export async function setPasswordWithLink(token: string, password: string) {
  setSession(await publicPost<Tokens>('/auth/set-password', { token, password }));
}

export async function logout() {
  const t = session;
  setSession(null);
  if (t) await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: t.refreshToken }) }).catch(() => {});
}
