import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { AuthCard } from '../features/auth/AuthCard'
import { RegisterForm } from '../features/auth/RegisterForm'
import { safeRedirect } from '../features/auth/useCurrentUser'
import { useI18n } from '../i18n/I18nProvider'

export const Route = createFileRoute('/register')({
  validateSearch: (s: Record<string, unknown>) => ({ redirect: safeRedirect(s.redirect) }),
  component: RegisterPage,
})

function RegisterPage() {
  const { redirect } = Route.useSearch()
  const router = useRouter()
  const { t } = useI18n()
  return (
    <AuthCard title={t('auth.register')}>
      <RegisterForm onSuccess={() => router.history.push(redirect ?? '/community')} />
      <p className="text-center text-sm text-stone-500">
        {t('auth.haveAccount')}
        <Link to="/login" search={{ redirect }} className="text-brand-700 hover:underline">
          {t('auth.login')}
        </Link>
      </p>
    </AuthCard>
  )
}
