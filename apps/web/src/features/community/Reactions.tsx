import { useQueryClient } from '@tanstack/react-query'
import { Bookmark, Heart } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { Post } from '../../api/generated/model'
import { favoritePost, likePost, unfavoritePost, unlikePost } from '../../api/generated/posts/posts'
import { useI18n } from '../../i18n/I18nProvider'
import { useServerError } from '../../i18n/serverErrors'
import { useCurrentUser } from '../auth/useCurrentUser'

/** Every query that lists posts (feed, profile tabs, favorites). */
const isPostList = (key: readonly unknown[]) => {
  const k = String(key[0] ?? '')
  return k === '/posts' || /^\/users\/[^/]+\/(posts|likes)$/.test(k) || k === '/auth/me/favorites'
}

const pill =
  'flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors disabled:opacity-60'

/**
 * Like + save buttons. Optimistic: the button flips at once and rolls back
 * if the request fails; afterwards every post list is refreshed.
 */
export function Reactions({ post }: { post: Post }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const serverError = useServerError()
  const { data: me } = useCurrentUser()
  // Local overrides until the refreshed list arrives.
  const [liked, setLiked] = useState<boolean | null>(null)
  const [saved, setSaved] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  const isLiked = liked ?? post.likedByMe
  const isSaved = saved ?? post.favoritedByMe
  const likeCount = post.likeCount + (liked === null ? 0 : Number(liked) - Number(post.likedByMe))

  async function toggle(kind: 'like' | 'favorite') {
    if (!me) {
      toast.info(t('post.signInFirst'))
      return
    }
    const on = kind === 'like' ? !isLiked : !isSaved
    const set = kind === 'like' ? setLiked : setSaved
    set(on)
    setBusy(true)
    try {
      const call =
        kind === 'like' ? (on ? likePost : unlikePost) : on ? favoritePost : unfavoritePost
      await call(post.id)
      await qc.invalidateQueries({ predicate: (q) => isPostList(q.queryKey) })
      // Profiles count posts per tab.
      void qc.invalidateQueries({
        predicate: (q) => /^\/users\/[^/]+$/.test(String(q.queryKey[0])),
      })
    } catch (err) {
      toast.error(serverError(err))
    } finally {
      set(null)
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        aria-pressed={isLiked}
        disabled={busy}
        onClick={() => toggle('like')}
        className={`${pill} ${isLiked ? 'text-rose-600 hover:bg-rose-50' : 'text-stone-500 hover:bg-stone-100 hover:text-stone-800'}`}
      >
        <Heart className="size-4" fill={isLiked ? 'currentColor' : 'none'} aria-hidden />
        {t('post.like')}
        <span className="tabular-nums">{likeCount}</span>
      </button>
      <button
        type="button"
        aria-pressed={isSaved}
        disabled={busy}
        onClick={() => toggle('favorite')}
        className={`${pill} ${isSaved ? 'text-amber-600 hover:bg-amber-50' : 'text-stone-500 hover:bg-stone-100 hover:text-stone-800'}`}
      >
        <Bookmark className="size-4" fill={isSaved ? 'currentColor' : 'none'} aria-hidden />
        {t('post.favorite')}
      </button>
    </>
  )
}
