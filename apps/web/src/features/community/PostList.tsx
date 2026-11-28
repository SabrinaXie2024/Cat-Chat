import { Link } from '@tanstack/react-router'
import { MessageCircle, PawPrint } from 'lucide-react'
import { useState } from 'react'
import type { Post } from '../../api/generated/model'
import { useListPosts } from '../../api/generated/posts/posts'
import { errorMessage } from '../../api/http'
import { CatAvatar } from '../../components/CatAvatar'
import { EmptyState } from '../../components/ui'
import { useI18n } from '../../i18n/I18nProvider'
import { MAX_REPLIES_PER_POST } from '../../lib/limits'
import { ImageGrid } from '../images/ImageGrid'
import { Replies } from './Replies'
import { TimeAgo } from './TimeAgo'

export function PostList() {
  const { t } = useI18n()
  const { data, error } = useListPosts()
  if (error) return <p className="text-red-600">{errorMessage(error)}</p>
  if (!data) return <p className="text-stone-500">{t('post.loading')}</p>

  const posts = data.data
  if (posts.length === 0) return <EmptyState icon={PawPrint}>{t('post.empty')}</EmptyState>

  return (
    <ul className="space-y-4">
      {posts.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
    </ul>
  )
}

export function PostCard({ post }: { post: Post }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const repliesId = `replies-${post.id}`

  return (
    <li
      className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-stone-100 sm:p-5"
      aria-label={t('post.cardLabel', { author: post.author })}
    >
      <div className="mb-3 flex items-center gap-3">
        {/* Same target as the name link below: mouse-only (hover title), so
            keyboard and screen-reader users get one link per author. */}
        <Link
          to="/users/$userId"
          params={{ userId: post.authorId }}
          title={t('profile.viewProfile', { name: post.author })}
          tabIndex={-1}
          aria-hidden
          className="rounded-full"
        >
          <CatAvatar avatar={post.authorAvatar} />
        </Link>
        <div className="min-w-0 leading-tight">
          <Link
            to="/users/$userId"
            params={{ userId: post.authorId }}
            className="block truncate font-medium text-stone-900 hover:text-brand-700"
          >
            {post.author}
          </Link>
          <p className="text-xs text-stone-400">
            <TimeAgo iso={post.createdAt} />
          </p>
        </div>
      </div>
      {/* Rendered as text, never HTML — React escapes it (XSS-safe). */}
      <p className="whitespace-pre-wrap break-words leading-relaxed text-stone-800">
        {post.content}
      </p>
      <ImageGrid urls={post.images} />
      <button
        type="button"
        aria-expanded={open}
        aria-controls={repliesId}
        onClick={() => setOpen((o) => !o)}
        className={`mt-3 flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition-colors ${
          open
            ? 'bg-brand-100 text-brand-700'
            : 'text-stone-500 hover:bg-stone-100 hover:text-stone-800'
        }`}
      >
        <MessageCircle className="size-4" aria-hidden />
        {open ? t('replies.close') : t('replies.open')} {post.replyCount}/{MAX_REPLIES_PER_POST}
      </button>
      <div id={repliesId}>{open && <Replies post={post} />}</div>
    </li>
  )
}
