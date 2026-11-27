import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { AuthCard } from '../features/auth/AuthCard'
import { ForgotPasswordForm } from '../features/auth/ForgotPasswordForm'
import { useI18n } from '../i18n/I18nProvider'

export const Route = createFileRoute('/forgot-password')({ component: ForgotPasswordPage })

function ForgotPasswordPage() {
  const { t } = useI18n()
  const router = useRouter()
  return (
    <AuthCard title={t('reset.title')}>
      <ForgotPasswordForm onSuccess={() => router.history.push('/community')} />
      <p className="text-center text-sm">
        <Link
          to="/login"
          search={{ redirect: undefined }}
          className="text-brand-700 hover:underline"
        >
          {t('reset.backToLogin')}
        </Link>
      </p>
    </AuthCard>
  )
}
