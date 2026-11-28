import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
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
import { buttonClass } from '../../components/ui'
import { useFieldError, useI18n } from '../../i18n/I18nProvider'
import { serverErrorKey, useServerError } from '../../i18n/serverErrors'
import {
  charCount,
  MAX_REPLIES_PER_POST,
  REPLY_MAX_CHARS,
  REPLY_MAX_IMAGES,
} from '../../lib/limits'
import { useCurrentUser } from '../auth/useCurrentUser'
import { ImagePicker } from '../images/ImagePicker'
import { ReplyItem } from './ReplyItem'

/** Reply thread shown under a post card. Mounted only while expanded. */
export function Replies({ post }: { post: Post }) {
  // `http` throws on non-2xx, so resolved data is always the 200 body.
  // API returns oldest first (stable for clients); show newest first.
  const { data: replies, error } = useListReplies(post.id, {
    // The pinned reply stays on top.
    query: {
      select: (res) => {
        const all = res.data as Reply[]
        return [...all.filter((r) => r.pinned), ...all.filter((r) => !r.pinned).reverse()]
      },
    },
  })
  const { t } = useI18n()
  const { data: user } = useCurrentUser()
  const full = post.replyCount >= MAX_REPLIES_PER_POST

  return (
    <div className="mt-3 space-y-3 rounded-xl bg-stone-50/80 p-3 sm:p-4">
      {/* Composer first, then newest replies: the latest conversation is
          what people came to see. */}
      {full ? (
        <p className="text-sm text-stone-500">{t('replies.full')}</p>
      ) : user ? (
        <ReplyForm postId={post.id} />
      ) : user === null ? (
        <p className="text-sm text-stone-500">
          <Link
            to="/login"
            search={{ redirect: '/community' }}
            className="text-brand-700 hover:underline"
          >
            {t('auth.login')}
          </Link>
          {t('replies.signInAfter')}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-red-600">{errorMessage(error)}</p>
      ) : !replies ? (
        <p className="text-sm text-stone-500">{t('replies.loading')}</p>
      ) : replies.length === 0 ? (
        <p className="text-sm text-stone-500">{t('replies.empty')}</p>
      ) : (
        <ol className="space-y-2" aria-label={t('replies.list')}>
          {replies.map((r) => (
            <ReplyItem key={r.id} reply={r} post={post} />
          ))}
        </ol>
      )}
    </div>
  )
}

const schema = z.object({
  content: z
    .string()
    .refine((s) => charCount(s) > 0, 'err.contentRequired')
    .refine((s) => charCount(s) <= REPLY_MAX_CHARS, 'err.replyTooLong'),
})
type Values = z.infer<typeof schema>

function ReplyForm({ postId }: { postId: string }) {
  const { t } = useI18n()
  const translateField = useFieldError()
  const serverError = useServerError()
  const qc = useQueryClient()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { content: '' } })
  const [imageIds, setImageIds] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [resetSignal, setResetSignal] = useState(0)
  const reply = useCreateReply({
    mutation: {
      onSuccess: () => {
        form.reset()
        setResetSignal((n) => n + 1)
      },
      // A 409 refetch flips the thread to "full" and unmounts this form, so
      // an inline error would vanish with it — toast instead.
      onError: (err) => {
        if (isThreadFull(err)) toast.error(t('replies.threadFull'))
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
  const fieldError = translateField(form.formState.errors.content?.message)

  return (
    <form
      onSubmit={form.handleSubmit((v) =>
        reply.mutate({ postId, data: { content: v.content, images: imageIds } }),
      )}
      className="space-y-1"
      noValidate
    >
      <label htmlFor={inputId} className="sr-only">
        {t('replies.label')}
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          placeholder={t('replies.placeholder')}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm placeholder:text-stone-400 focus:border-brand-500 focus:ring-4 focus:ring-brand-100 focus:outline-none"
          {...form.register('content')}
        />
        <button
          type="submit"
          disabled={reply.isPending || uploading}
          title={uploading ? t('images.uploadingTitle') : undefined}
          className={`${buttonClass.primary} shrink-0 px-3 py-2 text-sm`}
        >
          {t('replies.submit')}
        </button>
      </div>
      <div className="flex justify-between text-xs">
        <span role="alert" className="text-red-600">
          {fieldError ??
            (reply.error && !isThreadFull(reply.error) ? serverError(reply.error) : '')}
        </span>
        <span className={count > REPLY_MAX_CHARS ? 'text-red-600' : 'text-stone-400'}>
          {count}/{REPLY_MAX_CHARS}
        </span>
      </div>
      <ImagePicker
        max={REPLY_MAX_IMAGES}
        onChange={setImageIds}
        onBusyChange={setUploading}
        resetSignal={resetSignal}
        compact
      />
    </form>
  )
}

const isThreadFull = (err: unknown) => serverErrorKey(err) === 'replies.threadFull'
