import { MessageCircle } from 'lucide-react'
import { useState } from 'react'
import type { Post } from '../../api/generated/model'
import { useListPosts } from '../../api/generated/posts/posts'
import { errorMessage } from '../../api/http'
import { MAX_REPLIES_PER_POST } from '../../lib/limits'
import { Replies } from './Replies'
import { TimeAgo } from './TimeAgo'

export function PostList() {
  const { data, error } = useListPosts()
  if (error) return <p className="text-red-600">{errorMessage(error)}</p>
  if (!data) return <p className="text-stone-500">加载中…</p>

  const posts = data.data
  if (posts.length === 0) return <p className="text-stone-500">还没有帖子，来发第一条吧！</p>

  return (
    <ul className="space-y-3">
      {posts.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
    </ul>
  )
}

function PostCard({ post }: { post: Post }) {
  const [open, setOpen] = useState(false)
  const repliesId = `replies-${post.id}`

  return (
    <li className="rounded-xl bg-white p-4 shadow-sm" aria-label={`${post.author} 的帖子`}>
      <div className="mb-1 text-sm text-stone-500">
        {post.author} · <TimeAgo iso={post.createdAt} />
      </div>
      {/* Rendered as text, never HTML — React escapes it (XSS-safe). */}
      <p className="whitespace-pre-wrap break-words">{post.content}</p>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={repliesId}
        onClick={() => setOpen((o) => !o)}
        className="mt-2 flex items-center gap-1 rounded-md px-1 py-0.5 text-sm text-stone-500 hover:bg-stone-100 hover:text-stone-800"
      >
        <MessageCircle className="size-4" aria-hidden />
        {open ? '收起回复' : '回复'} {post.replyCount}/{MAX_REPLIES_PER_POST}
      </button>
      <div id={repliesId}>{open && <Replies post={post} />}</div>
    </li>
  )
}
