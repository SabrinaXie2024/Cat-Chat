import { Link } from '@tanstack/react-router'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import type { UserSummary } from '../../api/generated/model'
import { errorMessage } from '../../api/http'
import { CatAvatar } from '../../components/CatAvatar'
import { EmptyState } from '../../components/ui'
import { useI18n } from '../../i18n/I18nProvider'
import type { MessageKey } from '../../i18n/messages'

/** Followers / following: avatar + name rows linking to each profile. */
export function UserList({
  query,
  empty,
  icon,
}: {
  query: { data?: UserSummary[]; error: unknown }
  empty: MessageKey
  icon: LucideIcon
}) {
  const { t } = useI18n()
  if (query.error) return <p className="text-red-600">{errorMessage(query.error)}</p>
  if (!query.data) return <p className="text-stone-500">{t('profile.loading')}</p>
  if (query.data.length === 0) return <EmptyState icon={icon}>{t(empty)}</EmptyState>
  return (
    <ul className="divide-y divide-stone-100 overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-stone-100">
      {query.data.map((u) => (
        <li key={u.id}>
          <Link
            to="/users/$userId"
            params={{ userId: u.id }}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-stone-50"
          >
            <CatAvatar avatar={u.avatar} />
            <span className="min-w-0 flex-1 truncate font-medium text-stone-900">{u.nickname}</span>
            <ChevronRight className="size-4 text-stone-400" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  )
}
