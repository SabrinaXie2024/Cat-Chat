import ky, { HTTPError } from 'ky'

// Single HTTP transport for the generated client (see orval.config.ts).
// Cookies carry the session, so every request is same-origin + credentials.
const client = ky.create({
  prefix: '/api',
  credentials: 'include',
  retry: 0,
})

/**
 * orval fetch-style mutator. Resolves to `{ data, status, headers }` for 2xx;
 * non-2xx throws ky's HTTPError so TanStack Query puts it in `error`.
 */
export async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await client(url, init)
  const body = res.status === 204 ? undefined : await res.json()
  return { data: body, status: res.status, headers: res.headers } as T
}

/** User-facing message from any error thrown by `http`. */
export function errorMessage(err: unknown): string {
  if (err instanceof HTTPError) {
    const data = err.data as { message?: unknown } | undefined
    if (data && typeof data.message === 'string') return data.message
    return `Request failed (${err.response.status})`
  }
  return err instanceof Error ? err.message : 'Something went wrong'
}
