import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { Toaster } from 'sonner'
import { routeTree } from '../routeTree.gen'

const newQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })

export function renderWithQuery(ui: ReactElement) {
  return render(<QueryClientProvider client={newQueryClient()}>{ui}</QueryClientProvider>)
}

/** Renders the whole app (real routes, MSW API) starting at `path`. */
export function renderApp(path = '/') {
  const queryClient = newQueryClient()
  const history = createMemoryHistory({ initialEntries: [path] })
  const router = createRouter({ routeTree, history, context: { queryClient } })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>,
  )
  return { ...result, router }
}
