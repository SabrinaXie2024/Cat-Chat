import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { MessageCircle } from 'lucide-react'
import { useListPosts } from '../../api/generated/posts/posts'
import { errorMessage } from '../../api/http'
import { MAX_REPLIES_PER_POST } from '../../lib/limits'

export function PostList() {
  const { data, error } = useListPosts()
  if (error) return <p className="text-red-600">{errorMessage(error)}</p>
  if (!data) return <p className="text-stone-500">加载中…</p>

  const posts = data.data
  if (posts.length === 0) return <p className="text-stone-500">还没有帖子，来发第一条吧！</p>

  return (
    <ul className="space-y-3">
      {posts.map((p) => (
        <li key={p.id} className="rounded-xl bg-white p-4 shadow-sm">
          <div className="mb-1 text-sm text-stone-500">
            {p.author} ·{' '}
            {formatDistanceToNow(new Date(p.createdAt), { addSuffix: true, locale: zhCN })}
          </div>
          {/* Rendered as text, never HTML — React escapes it (XSS-safe). */}
          <p className="whitespace-pre-wrap break-words">{p.content}</p>
          <div className="mt-2 flex items-center gap-1 text-sm text-stone-500">
            <MessageCircle className="size-4" aria-hidden />
            {p.replyCount}/{MAX_REPLIES_PER_POST}
          </div>
        </li>
      ))}
    </ul>
  )
}
