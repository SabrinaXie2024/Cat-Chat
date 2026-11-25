import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import { Cat } from 'lucide-react'
import { UserMenu } from '../features/auth/UserMenu'

const nav = [
  { to: '/guide', label: '养猫攻略' },
  { to: '/gallery', label: '我的猫咪' },
  { to: '/community', label: '猫咪日常' },
] as const

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
})

function RootLayout() {
  return (
    <div className="min-h-dvh bg-brand-50 text-stone-800">
      <header className="border-b border-stone-200 bg-white">
        <nav className="mx-auto flex max-w-4xl items-center gap-6 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold text-brand-700">
            <Cat className="size-5" aria-hidden /> Cat Chat
          </Link>
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="text-sm text-stone-600 hover:text-stone-900"
              activeProps={{ className: 'text-sm font-medium text-brand-700' }}
            >
              {n.label}
            </Link>
          ))}
          <UserMenu />
        </nav>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
