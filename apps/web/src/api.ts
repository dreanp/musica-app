export const API = ((import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000').replace(/\/$/, '');

export const getToken = () => localStorage.getItem('proto-token') ?? '';
export const setToken = (t: string) => localStorage.setItem('proto-token', t);

/** Monta a URL da API já com o token do protótipo (?k=). */
export function apiUrl(path: string) {
  const k = getToken();
  if (!k) return `${API}${path}`;
  return `${API}${path}${path.includes('?') ? '&' : '?'}k=${encodeURIComponent(k)}`;
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(apiUrl(path));
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}
