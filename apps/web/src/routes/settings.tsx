import { createFileRoute, Navigate } from '@tanstack/react-router'
import { PageHero } from '../components/ui'
import { ChangePasswordForm } from '../features/auth/ChangePasswordForm'
import { useCurrentUser } from '../features/auth/useCurrentUser'
import { useI18n } from '../i18n/I18nProvider'

export const Route = createFileRoute('/settings')({ component: SettingsPage })

const card = 'space-y-4 rounded-2xl bg-white p-5 shadow-card ring-1 ring-stone-100 sm:p-6'

function SettingsPage() {
  const { t } = useI18n()
  const { data: user } = useCurrentUser()
  if (user === undefined) return null
  // No ?redirect=: account pages are never a post-login destination.
  if (user === null) return <Navigate to="/login" search={{ redirect: undefined }} replace />

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <PageHero icon="⚙️" title={t('settings.title')} />
      <section className={card} aria-labelledby="account-info">
        <h2 id="account-info" className="text-lg font-semibold text-stone-900">
          {t('settings.info')}
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-stone-500">{t('auth.nickname')}</dt>
          <dd>{user.nickname}</dd>
          <dt className="text-stone-500">{t('auth.email')}</dt>
          <dd>{user.email}</dd>
        </dl>
      </section>
      <section className={card} aria-labelledby="change-password">
        <h2 id="change-password" className="text-lg font-semibold text-stone-900">
          {t('settings.changePassword')}
        </h2>
        <ChangePasswordForm email={user.email} />
      </section>
    </div>
  )
}
