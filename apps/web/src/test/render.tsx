import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { Toaster } from 'sonner'
import { I18nProvider, type Lang } from '../i18n/I18nProvider'
import { routeTree } from '../routeTree.gen'

const newQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

// Tests default to Chinese (the source language) unless they pass `lang`.
export function renderWithQuery(ui: ReactElement, { lang = 'zh' }: { lang?: Lang } = {}) {
  return render(
    <I18nProvider initialLang={lang}>
      <QueryClientProvider client={newQueryClient()}>{ui}</QueryClientProvider>
    </I18nProvider>,
  )
}

/** Renders the whole app (real routes, MSW API) starting at `path`. */
/** `lang: null` = no pinned language, i.e. follow the (stubbed) system language. */
export function renderApp(path = '/', { lang = 'zh' }: { lang?: Lang | null } = {}) {
  const queryClient = newQueryClient()
  const history = createMemoryHistory({ initialEntries: [path] })
  const router = createRouter({ routeTree, history, context: { queryClient } })
  const result = render(
    <I18nProvider initialLang={lang ?? undefined}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster />
      </QueryClientProvider>
    </I18nProvider>,
  )
  return { ...result, router }
}
