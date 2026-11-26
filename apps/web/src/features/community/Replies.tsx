import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import type { Post, Reply } from '../../api/generated/model'
import {
  getListPostsQueryKey,
  getListRepliesQueryKey,
  useCreateReply,
  useListReplies,
} from '../../api/generated/posts/posts'
import { errorMessage } from '../../api/http'
import { charCount, MAX_REPLIES_PER_POST, REPLY_MAX_CHARS } from '../../lib/limits'
import { useCurrentUser } from '../auth/useCurrentUser'
import { TimeAgo } from './TimeAgo'

/** Reply thread shown under a post card. Mounted only while expanded. */
export function Replies({ post }: { post: Post }) {
  // `http` throws on non-2xx, so resolved data is always the 200 body.
  const { data: replies, error } = useListReplies(post.id, {
    query: { select: (res) => res.data as Reply[] },
  })
  const { data: user } = useCurrentUser()
  const full = post.replyCount >= MAX_REPLIES_PER_POST

  return (
    <div className="mt-3 space-y-3 border-t border-stone-100 pt-3">
      {error ? (
        <p className="text-sm text-red-600">{errorMessage(error)}</p>
      ) : !replies ? (
        <p className="text-sm text-stone-500">加载回复中…</p>
      ) : replies.length === 0 ? (
        <p className="text-sm text-stone-500">还没有回复</p>
      ) : (
        <ol className="space-y-2" aria-label="回复列表">
          {replies.map((r) => (
            <li key={r.id} className="rounded-lg bg-stone-50 px-3 py-2 text-sm">
              <div className="mb-0.5 text-xs text-stone-500">
                {r.author} · <TimeAgo iso={r.createdAt} />
              </div>
              <p className="whitespace-pre-wrap break-words">{r.content}</p>
            </li>
          ))}
        </ol>
      )}

      {full ? (
        <p className="text-sm text-stone-500">
          这条帖子已经有 {MAX_REPLIES_PER_POST} 条回复，不能再回复了
        </p>
      ) : user ? (
        <ReplyForm postId={post.id} />
      ) : user === null ? (
        <p className="text-sm text-stone-500">
          <Link
            to="/login"
            search={{ redirect: '/community' }}
            className="text-brand-700 hover:underline"
          >
            登录
          </Link>
          后参与回复
        </p>
      ) : null}
    </div>
  )
}

const schema = z.object({
  content: z
    .string()
    .refine((s) => charCount(s) > 0, '写点什么吧')
    .refine((s) => charCount(s) <= REPLY_MAX_CHARS, `最多 ${REPLY_MAX_CHARS} 字`),
})
type Values = z.infer<typeof schema>

function ReplyForm({ postId }: { postId: string }) {
  const qc = useQueryClient()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { content: '' } })
  const reply = useCreateReply({
    mutation: {
      onSuccess: () => form.reset(),
      // A 409 refetch flips the thread to "full" and unmounts this form, so
      // an inline error would vanish with it — toast instead.
      onError: (err) => {
        if (isThreadFull(err)) toast.error('回复已满，刚刚被别人抢先了')
      },
      // Refresh both on success and on 409 (someone else took the last slot).
      onSettled: () =>
        Promise.all([
          qc.invalidateQueries({ queryKey: getListRepliesQueryKey(postId) }),
          qc.invalidateQueries({ queryKey: getListPostsQueryKey() }),
        ]),
    },
  })
  const count = charCount(form.watch('content'))
  const inputId = `reply-${postId}`
  const fieldError = form.formState.errors.content?.message

  return (
    <form
      onSubmit={form.handleSubmit((v) =>
        reply.mutate({ postId, data: { content: v.content, images: [] } }),
      )}
      className="space-y-1"
      noValidate
    >
      <label htmlFor={inputId} className="sr-only">
        写下你的回复
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          placeholder="写下你的回复…"
          autoComplete="off"
          className="min-w-0 flex-1 rounded-lg border border-stone-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
          {...form.register('content')}
        />
        <button
          type="submit"
          disabled={reply.isPending}
          className="shrink-0 rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          回复
        </button>
      </div>
      <div className="flex justify-between text-xs">
        <span role="alert" className="text-red-600">
          {fieldError ??
            (reply.error && !isThreadFull(reply.error) ? replyErrorText(reply.error) : '')}
        </span>
        <span className={count > REPLY_MAX_CHARS ? 'text-red-600' : 'text-stone-400'}>
          {count}/{REPLY_MAX_CHARS}
        </span>
      </div>
    </form>
  )
}

const isThreadFull = (err: unknown) => errorMessage(err).includes('maximum number of replies')

function replyErrorText(err: unknown) {
  const msg = errorMessage(err)
  if (msg.startsWith('please sign in')) return '登录已过期，请重新登录'
  return msg
}
