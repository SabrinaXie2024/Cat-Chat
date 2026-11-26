import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { AuthCard } from '../features/auth/AuthCard'
import { LoginForm } from '../features/auth/LoginForm'
import { safeRedirect } from '../features/auth/useCurrentUser'
import { useI18n } from '../i18n/I18nProvider'

export const Route = createFileRoute('/login')({
  validateSearch: (s: Record<string, unknown>) => ({ redirect: safeRedirect(s.redirect) }),
  component: LoginPage,
})

function LoginPage() {
  const { redirect } = Route.useSearch()
  const router = useRouter()
  const { t } = useI18n()
  return (
    <AuthCard title={t('auth.login')}>
      <LoginForm onSuccess={() => router.history.push(redirect ?? '/community')} />
      <p className="text-center text-sm text-stone-500">
        {t('auth.noAccount')}
        <Link to="/register" search={{ redirect }} className="text-brand-700 hover:underline">
          {t('auth.register')}
        </Link>
      </p>
    </AuthCard>
  )
}
