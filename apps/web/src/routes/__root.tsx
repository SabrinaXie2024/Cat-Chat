import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import { Cat } from 'lucide-react'
import { UserMenu } from '../features/auth/UserMenu'
import { useI18n } from '../i18n/I18nProvider'
import { LanguageSwitch } from '../i18n/LanguageSwitch'

const nav = [
  { to: '/guide', label: 'nav.guide' },
  { to: '/gallery', label: 'nav.gallery' },
  { to: '/community', label: 'nav.community' },
] as const

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
})

function RootLayout() {
  const { t } = useI18n()
  return (
    <div className="min-h-dvh bg-brand-50 text-stone-800">
      <header className="border-b border-stone-200 bg-white">
        <nav className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold text-brand-700">
            <Cat className="size-5" aria-hidden /> {t('brand')}
          </Link>
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="text-sm text-stone-600 hover:text-stone-900"
              activeProps={{ className: 'text-sm font-medium text-brand-700' }}
            >
              {t(n.label)}
            </Link>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <LanguageSwitch />
            <UserMenu />
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
