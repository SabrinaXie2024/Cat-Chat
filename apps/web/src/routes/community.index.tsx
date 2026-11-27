import { createFileRoute, Link } from '@tanstack/react-router'
import { MessageCircle } from 'lucide-react'
import { buttonClass, PageHero } from '../components/ui'
import { useCurrentUser } from '../features/auth/useCurrentUser'
import { NewPostForm } from '../features/community/NewPostForm'
import { PostList } from '../features/community/PostList'
import { useI18n } from '../i18n/I18nProvider'

export const Route = createFileRoute('/community/')({ component: Community })

function Community() {
  const { t } = useI18n()
  const { data: user } = useCurrentUser()
  return (
    <section className="mx-auto max-w-3xl space-y-6">
      <PageHero
        icon={MessageCircle}
        title={t('community.title')}
        subtitle={t('community.subtitle')}
      />
      {user ? (
        <NewPostForm />
      ) : user === null ? (
        <p className="flex flex-wrap items-center gap-x-1 gap-y-2 rounded-2xl bg-white p-4 text-stone-600 shadow-card ring-1 ring-stone-100 sm:p-5">
          <Link
            to="/login"
            search={{ redirect: '/community' }}
            className={`${buttonClass.primary} px-3 py-1 text-sm`}
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
