import { createFileRoute, Link } from '@tanstack/react-router'
import { useCurrentUser } from '../features/auth/useCurrentUser'
import { NewPostForm } from '../features/community/NewPostForm'
import { PostList } from '../features/community/PostList'
import { useI18n } from '../i18n/I18nProvider'

export const Route = createFileRoute('/community/')({ component: Community })

function Community() {
  const { t } = useI18n()
  const { data: user } = useCurrentUser()
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-bold">{t('community.title')}</h1>
      {user ? (
        <NewPostForm />
      ) : user === null ? (
        <p className="rounded-xl bg-white p-4 text-stone-600 shadow-sm">
          <Link
            to="/login"
            search={{ redirect: '/community' }}
            className="text-brand-700 hover:underline"
          >
            {t('auth.login')}
          </Link>
          {t('community.signInAfter')}
        </p>
      ) : null}
      <PostList />
    </section>
  )
}
