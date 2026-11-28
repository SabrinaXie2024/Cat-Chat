import { Bookmark, Heart, Lock, PawPrint, Users } from 'lucide-react'
import { type KeyboardEvent, useId, useRef, useState } from 'react'
import type { Post, UserSummary } from '../../api/generated/model'
import {
  useListFollowers,
  useListFollowing,
  useListMyFavorites,
  useListUserLikes,
  useListUserPosts,
} from '../../api/generated/users/users'
import { errorMessage } from '../../api/http'
import { EmptyState } from '../../components/ui'
import { useI18n } from '../../i18n/I18nProvider'
import type { MessageKey } from '../../i18n/messages'
import { PostCard } from '../community/PostList'
import { UserList } from './UserList'

type Tab = 'posts' | 'likes' | 'favorites' | 'following' | 'followers'

const LABELS: Record<Tab, MessageKey> = {
  posts: 'profile.posts',
  likes: 'profile.likes',
  favorites: 'profile.favorites',
  following: 'profile.following',
  followers: 'profile.followers',
}

/** Profile sections as an ARIA tablist (arrow keys move between tabs). */
export function ProfileTabs({ userId, isMe }: { userId: string; isMe: boolean }) {
  const { t } = useI18n()
  const base = useId()
  // Favorites are private: only on your own profile.
  const tabs: Tab[] = isMe
    ? ['posts', 'likes', 'favorites', 'following', 'followers']
    : ['posts', 'likes', 'following', 'followers']
  const [active, setActive] = useState<Tab>('posts')
  const refs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})
  const current = tabs.includes(active) ? active : 'posts'

  const onKey = (e: KeyboardEvent) => {
    const i = tabs.indexOf(current)
    const next =
      e.key === 'ArrowRight'
        ? tabs[(i + 1) % tabs.length]
        : e.key === 'ArrowLeft'
          ? tabs[(i - 1 + tabs.length) % tabs.length]
          : e.key === 'Home'
            ? tabs[0]
            : e.key === 'End'
              ? tabs[tabs.length - 1]
              : undefined
    if (!next) return
    e.preventDefault()
    setActive(next)
    refs.current[next]?.focus()
  }

  return (
    <section className="space-y-4">
      <div
        role="tablist"
        aria-label={t('profile.tabs')}
        onKeyDown={onKey}
        className="flex gap-1 overflow-x-auto rounded-2xl bg-white p-1.5 shadow-card ring-1 ring-stone-100"
      >
        {tabs.map((tab) => (
          <button
            key={tab}
            ref={(el) => {
              refs.current[tab] = el
            }}
            id={`${base}-${tab}`}
            type="button"
            role="tab"
            aria-selected={tab === current}
            aria-controls={`${base}-panel`}
            tabIndex={tab === current ? 0 : -1}
            onClick={() => setActive(tab)}
            className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition-colors ${
              tab === current
                ? 'bg-brand-500 text-white shadow-sm'
                : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
            }`}
          >
            {t(LABELS[tab])}
            {tab === 'favorites' && <Lock className="size-3.5" aria-hidden />}
          </button>
        ))}
      </div>
      <div id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-${current}`}>
        {current === 'posts' && <UserPostsPanel userId={userId} />}
        {current === 'likes' && <LikesPanel userId={userId} />}
        {current === 'favorites' && <FavoritesPanel />}
        {current === 'following' && <FollowingPanel userId={userId} />}
        {current === 'followers' && <FollowersPanel userId={userId} />}
      </div>
    </section>
  )
}

function Posts({
  query,
  empty,
  emptyIcon,
}: {
  query: { data?: Post[]; error: unknown }
  empty: MessageKey
  emptyIcon: typeof PawPrint
}) {
  const { t } = useI18n()
  if (query.error) return <p className="text-red-600">{errorMessage(query.error)}</p>
  if (!query.data) return <p className="text-stone-500">{t('profile.loading')}</p>
  if (query.data.length === 0) return <EmptyState icon={emptyIcon}>{t(empty)}</EmptyState>
  return (
    <ul className="space-y-4">
      {query.data.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
    </ul>
  )
}

const asPosts = { query: { select: (res: { data: unknown }) => res.data as Post[] } }
const asUsers = { query: { select: (res: { data: unknown }) => res.data as UserSummary[] } }

function UserPostsPanel({ userId }: { userId: string }) {
  return (
    <Posts query={useListUserPosts(userId, asPosts)} empty="profile.noPosts" emptyIcon={PawPrint} />
  )
}

function LikesPanel({ userId }: { userId: string }) {
  return (
    <Posts query={useListUserLikes(userId, asPosts)} empty="profile.noLikes" emptyIcon={Heart} />
  )
}

function FavoritesPanel() {
  const { t } = useI18n()
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-sm text-stone-500">
        <Lock className="size-3.5" aria-hidden />
        {t('profile.favoritesPrivate')}
      </p>
      <Posts query={useListMyFavorites(asPosts)} empty="profile.noFavorites" emptyIcon={Bookmark} />
    </div>
  )
}

function FollowingPanel({ userId }: { userId: string }) {
  return (
    <UserList query={useListFollowing(userId, asUsers)} empty="profile.noFollowing" icon={Users} />
  )
}

function FollowersPanel({ userId }: { userId: string }) {
  return (
    <UserList query={useListFollowers(userId, asUsers)} empty="profile.noFollowers" icon={Users} />
  )
}
