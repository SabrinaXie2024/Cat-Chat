import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { HTTPError } from 'ky'
import { getGetMeQueryKey, getMe, useLogout } from '../../api/generated/auth/auth'
import type { User } from '../../api/generated/model'

export const meQueryKey = getGetMeQueryKey()

/** Signed-in user, `null` when signed out, `undefined` while loading. */
export function useCurrentUser() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: async (): Promise<User | null> => {
      try {
        return (await getMe()).data as User
      } catch (err) {
        if (err instanceof HTTPError && err.response.status === 401) return null
        throw err
      }
    },
    staleTime: 5 * 60_000,
  })
}

export function useSignOut() {
  const qc = useQueryClient()
  const router = useRouter()
  return useLogout({
    mutation: {
      onSettled: async () => {
        // Leave account pages *before* clearing the user, otherwise the page's
        // signed-out guard would bounce to /login and the next sign-in could
        // land straight back on account settings.
        if (isAccountPath(router.state.location.pathname)) {
          await router.navigate({ to: '/', replace: true })
        }
        qc.setQueryData(meQueryKey, null)
      },
    },
  })
}

/**
 * Account pages (settings and anything under it). These are never a
 * post-login destination: signing in always starts from a neutral page, so
 * whoever signs in next on a shared device isn't dropped into account
 * controls.
 */
export function isAccountPath(path: string): boolean {
  const pathname = path.split(/[?#]/)[0] ?? ''
  return pathname === '/settings' || pathname.startsWith('/settings/')
}

/**
 * `?redirect=` target after login/register: same-site relative paths only
 * (no open redirect), and never an account page.
 */
export function safeRedirect(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//'))
    return undefined
  return isAccountPath(value) ? undefined : value
}
