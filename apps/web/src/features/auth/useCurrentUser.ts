import { useQuery, useQueryClient } from '@tanstack/react-query'
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
  return useLogout({
    mutation: { onSettled: () => qc.setQueryData(meQueryKey, null) },
  })
}

/** Only same-site relative paths, so `?redirect=` can't send users off-site. */
export function safeRedirect(value: unknown): string | undefined {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : undefined
}
