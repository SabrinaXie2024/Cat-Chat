import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { getListPostsQueryKey, useCreatePost } from '../../api/generated/posts/posts'
import { Avatar, buttonClass } from '../../components/ui'
import { useFieldError, useI18n } from '../../i18n/I18nProvider'
import { useServerError } from '../../i18n/serverErrors'
import { charCount, POST_MAX_CHARS, POST_MAX_IMAGES } from '../../lib/limits'
import { useCurrentUser } from '../auth/useCurrentUser'
import { ImagePicker } from '../images/ImagePicker'

const schema = z.object({
  content: z
    .string()
    .refine((s) => charCount(s) > 0, 'err.contentRequired')
    .refine((s) => charCount(s) <= POST_MAX_CHARS, 'err.postTooLong'),
})
type Values = z.infer<typeof schema>

export function NewPostForm() {
  const { t } = useI18n()
  const fieldError = useFieldError()
  const serverError = useServerError()
  const qc = useQueryClient()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { content: '' } })
  const [imageIds, setImageIds] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [resetSignal, setResetSignal] = useState(0)
  const create = useCreatePost({
    mutation: {
      onSuccess: () => {
        form.reset()
        setResetSignal((n) => n + 1)
        toast.success(t('post.published'))
        return qc.invalidateQueries({ queryKey: getListPostsQueryKey() })
      },
      onError: (err) => toast.error(serverError(err)),
    },
  })
  const count = charCount(form.watch('content'))
  const { data: me } = useCurrentUser()

  return (
    <form
      onSubmit={form.handleSubmit((v) =>
        create.mutate({ data: { content: v.content, images: imageIds } }),
      )}
      className="space-y-3 rounded-2xl bg-white p-4 shadow-card ring-1 ring-stone-100 sm:p-5"
    >
      <div className="flex gap-3">
        {me && <Avatar name={me.nickname} />}
        <div className="min-w-0 flex-1">
          <label htmlFor="content" className="sr-only">
            {t('post.label')}
          </label>
          <textarea
            id="content"
            rows={3}
            placeholder={t('post.placeholder')}
            className="w-full resize-none rounded-xl border-0 bg-stone-50 p-3 text-stone-900 placeholder:text-stone-400 focus:bg-white focus:ring-4 focus:ring-brand-100 focus:outline-none"
            {...form.register('content')}
          />
        </div>
      </div>
      <ImagePicker
        max={POST_MAX_IMAGES}
        onChange={setImageIds}
        onBusyChange={setUploading}
        resetSignal={resetSignal}
      />
      <div className="flex items-center justify-between border-t border-stone-100 pt-3 text-sm">
        <span className={count > POST_MAX_CHARS ? 'text-red-600' : 'text-stone-400'}>
          {count}/{POST_MAX_CHARS}
          {form.formState.errors.content && (
            <span role="alert" className="ml-2 text-red-600">
              {fieldError(form.formState.errors.content.message)}
            </span>
          )}
        </span>
        <button
          type="submit"
          disabled={create.isPending || uploading}
          title={uploading ? t('images.uploadingTitle') : undefined}
          className={`${buttonClass.primary} px-5`}
        >
          {t('post.submit')}
        </button>
      </div>
    </form>
  )
}
