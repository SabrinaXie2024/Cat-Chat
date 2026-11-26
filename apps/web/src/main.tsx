import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import { I18nProvider } from './i18n/I18nProvider'
import { routeTree } from './routeTree.gen'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
})
const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

async function enableMocks() {
  // MSW is the default in dev; `VITE_API=real` talks to the Go server.
  if (!import.meta.env.DEV || import.meta.env.VITE_API === 'real') return
  const { worker } = await import('./mocks/browser')
  await worker.start({ onUnhandledRequest: 'bypass' })
}

enableMocks().then(() => {
  const root = document.getElementById('root')
  if (!root) throw new Error('#root missing')
  createRoot(root).render(
    <StrictMode>
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
          <Toaster richColors position="top-center" />
        </QueryClientProvider>
      </I18nProvider>
    </StrictMode>,
  )
})
