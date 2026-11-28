import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { format } from 'date-fns'
import { PawPrint, Pencil, UserRoundX } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useUpdateProfile } from '../api/generated/auth/auth'
import type { Avatar, Post, Profile, User } from '../api/generated/model'
import {
  getGetProfileQueryKey,
  useFollowUser,
  useGetProfile,
  useListUserPosts,
  useUnfollowUser,
} from '../api/generated/users/users'
import { errorMessage } from '../api/http'
import { AVATARS, CatAvatar } from '../components/CatAvatar'
import { buttonClass, Card, EmptyState, inputClass } from '../components/ui'
import { meQueryKey, useCurrentUser } from '../features/auth/useCurrentUser'
import { PostCard } from '../features/community/PostList'
import { useI18n } from '../i18n/I18nProvider'
import type { MessageKey } from '../i18n/messages'
import { useServerError } from '../i18n/serverErrors'
import { charCount, NICKNAME_MAX_CHARS } from '../lib/limits'

export const Route = createFileRoute('/users/$userId')({ component: ProfilePage })

function ProfilePage() {
  const { userId } = Route.useParams()
  const { t } = useI18n()
  const { data: me } = useCurrentUser()
  const profile = useGetProfile(userId, {
    query: { select: (res) => res.data as Profile, retry: false },
  })
  const [editing, setEditing] = useState(false)

  if (profile.isError)
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState icon={UserRoundX}>{t('profile.notFound')}</EmptyState>
      </div>
    )
  if (!profile.data) return <p className="text-stone-500">{t('profile.loading')}</p>

  const p = profile.data
  const isMe = me?.id === p.id

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <ProfileHeader
        profile={p}
        action={
          isMe ? (
            !editing && (
              <button
                type="button"
                className={buttonClass.secondary}
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-4" aria-hidden />
                {t('profile.edit')}
              </button>
            )
          ) : (
            <FollowButton profile={p} signedIn={!!me} />
          )
        }
      />
      {isMe && me && editing && <EditProfile me={me} onDone={() => setEditing(false)} />}
      <UserPosts userId={p.id} title={t(isMe ? 'profile.myPosts' : 'profile.theirPosts')} />
    </div>
  )
}

function ProfileHeader({ profile: p, action }: { profile: Profile; action: React.ReactNode }) {
  const { t, dateLocale } = useI18n()
  const stats: [MessageKey, number][] = [
    ['profile.posts', p.postCount],
    ['profile.followers', p.followerCount],
    ['profile.following', p.followingCount],
  ]
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-100 via-brand-50 to-amber-50 p-6 ring-1 ring-brand-100 sm:p-8">
      <PawPrint
        className="pointer-events-none absolute -right-6 -bottom-8 size-44 rotate-12 text-brand-500 opacity-[0.07]"
        aria-hidden
      />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
        <CatAvatar avatar={p.avatar} size="lg" className="shadow-card ring-4 ring-white" />
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="truncate text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">
            {p.nickname}
          </h1>
          <p className="text-sm text-stone-500">
            {t('profile.joined', {
              date: format(new Date(p.createdAt), 'PPP', { locale: dateLocale }),
            })}
          </p>
          <dl className="flex gap-6 pt-2">
            {stats.map(([label, n]) => (
              <div key={label} className="flex flex-col-reverse">
                <dt className="text-xs text-stone-500">{t(label)}</dt>
                <dd className="text-lg font-semibold text-stone-900 tabular-nums">{n}</dd>
              </div>
            ))}
          </dl>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  )
}

function FollowButton({ profile: p, signedIn }: { profile: Profile; signedIn: boolean }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const serverError = useServerError()
  const opts = {
    mutation: {
      onSettled: () => qc.invalidateQueries({ queryKey: getGetProfileQueryKey(p.id) }),
      onError: (err: unknown) => toast.error(serverError(err)),
    },
  }
  const follow = useFollowUser(opts)
  const unfollow = useUnfollowUser(opts)
  const busy = follow.isPending || unfollow.isPending

  if (!signedIn)
    return (
      <Link to="/login" search={{ redirect: `/users/${p.id}` }} className={buttonClass.primary}>
        {t('profile.signInToFollow')}
      </Link>
    )
  return p.followedByMe ? (
    <button
      type="button"
      className={buttonClass.secondary}
      disabled={busy}
      aria-pressed="true"
      onClick={() => unfollow.mutate({ userId: p.id })}
    >
      {t('profile.unfollow')}
    </button>
  ) : (
    <button
      type="button"
      className={buttonClass.primary}
      disabled={busy}
      aria-pressed="false"
      onClick={() => follow.mutate({ userId: p.id })}
    >
      {t('profile.follow')}
    </button>
  )
}

function EditProfile({ me, onDone }: { me: User; onDone: () => void }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const serverError = useServerError()
  const [nickname, setNickname] = useState(me.nickname)
  const [avatar, setAvatar] = useState<Avatar>(me.avatar)
  const [error, setError] = useState<string | null>(null)
  const save = useUpdateProfile({
    mutation: {
      onSuccess: (res) => {
        qc.setQueryData(meQueryKey, res.data as User)
        // Name/avatar appear on the profile and on every post and reply.
        void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== meQueryKey[0] })
        toast.success(t('profile.saved'))
        onDone()
      },
      onError: (err) => toast.error(serverError(err)),
    },
  })

  return (
    <Card
      as="form"
      className="space-y-5"
      aria-label={t('profile.edit')}
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault()
        const n = nickname.trim()
        if (charCount(n) < 1) return setError(t('err.nicknameRequired'))
        if (charCount(n) > NICKNAME_MAX_CHARS) return setError(t('err.nicknameTooLong'))
        setError(null)
        save.mutate({ data: { nickname: n, avatar } })
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor="profile-nickname" className="text-sm font-medium text-stone-700">
          {t('auth.nickname')}
        </label>
        <input
          id="profile-nickname"
          className={inputClass}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? 'profile-nickname-error' : undefined}
          autoComplete="nickname"
        />
        {error && (
          <p id="profile-nickname-error" className="text-sm text-red-600">
            {error}
          </p>
        )}
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-stone-700">{t('profile.avatar')}</legend>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
          {AVATARS.map((a) => (
            <label
              key={a}
              className="flex cursor-pointer flex-col items-center gap-1 rounded-xl p-1.5 text-xs text-stone-600 ring-2 ring-transparent transition has-[:checked]:bg-brand-50 has-[:checked]:text-brand-700 has-[:checked]:ring-brand-400 has-[:focus-visible]:ring-brand-500 hover:bg-stone-50"
            >
              <input
                type="radio"
                name="avatar"
                value={a}
                checked={avatar === a}
                onChange={() => setAvatar(a)}
                className="sr-only"
              />
              <CatAvatar avatar={a} size="md" className="size-12" />
              {t(`avatar.${a}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex justify-end gap-2">
        <button type="button" className={buttonClass.secondary} onClick={onDone}>
          {t('profile.cancel')}
        </button>
        <button type="submit" className={buttonClass.primary} disabled={save.isPending}>
          {t('profile.save')}
        </button>
      </div>
    </Card>
  )
}

function UserPosts({ userId, title }: { userId: string; title: string }) {
  const { t } = useI18n()
  const { data, error } = useListUserPosts(userId, {
    query: { select: (res) => res.data as Post[] },
  })
  return (
    <section className="space-y-4" aria-labelledby="user-posts">
      <h2 id="user-posts" className="text-lg font-semibold text-stone-900">
        {title}
      </h2>
      {error ? (
        <p className="text-red-600">{errorMessage(error)}</p>
      ) : !data ? (
        <p className="text-stone-500">{t('profile.loading')}</p>
      ) : data.length === 0 ? (
        <EmptyState icon={PawPrint}>{t('profile.noPosts')}</EmptyState>
      ) : (
        <ul className="space-y-4">
          {data.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </ul>
      )}
    </section>
  )
}
