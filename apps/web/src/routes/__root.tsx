import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router'
import { UserMenu } from '../features/auth/UserMenu'
import { useI18n } from '../i18n/I18nProvider'
import { LanguageSwitch } from '../i18n/LanguageSwitch'

const nav = [
  { to: '/guide', label: 'nav.guide', icon: '📖' },
  { to: '/gallery', label: 'nav.gallery', icon: '🐈' },
  { to: '/community', label: 'nav.community', icon: '💬' },
] as const

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
})

function RootLayout() {
  const { t } = useI18n()
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-brand-100/80 bg-white/80 backdrop-blur-md">
        <nav className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2.5 sm:gap-4">
          <Link to="/" className="flex shrink-0 items-center gap-2 font-bold text-stone-900">
            <span
              className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-300 to-brand-500 text-lg shadow-sm"
              aria-hidden
            >
              🐱
            </span>
            <span className="hidden text-lg tracking-tight sm:inline">{t('brand')}</span>
          </Link>
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-stone-600 transition-colors hover:bg-brand-50 hover:text-stone-900"
                activeProps={{
                  className:
                    'bg-brand-100 font-medium text-brand-700 hover:bg-brand-100 hover:text-brand-700',
                }}
              >
                <span aria-hidden>{n.icon}</span>
                {t(n.label)}
              </Link>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <LanguageSwitch />
            <UserMenu />
          </div>
        </nav>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-10">
        <Outlet />
      </main>

      <footer className="border-t border-brand-100 bg-white/60">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-1 px-4 py-6 text-center text-sm text-stone-500 sm:flex-row sm:justify-between sm:text-left">
          <span className="font-medium text-stone-700">🐾 {t('brand')} · MeowSphere</span>
          <span>{t('footer.tagline')}</span>
        </div>
      </footer>
    </div>
  )
}
