import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { getListPostsQueryKey, useCreatePost } from '../../api/generated/posts/posts'
import { useFieldError, useI18n } from '../../i18n/I18nProvider'
import { useServerError } from '../../i18n/serverErrors'
import { charCount, POST_MAX_CHARS, POST_MAX_IMAGES } from '../../lib/limits'
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

  return (
    <form
      onSubmit={form.handleSubmit((v) =>
        create.mutate({ data: { content: v.content, images: imageIds } }),
      )}
      className="space-y-2 rounded-xl bg-white p-4 shadow-sm"
    >
      <label htmlFor="content" className="sr-only">
        {t('post.label')}
      </label>
      <textarea
        id="content"
        rows={3}
        placeholder={t('post.placeholder')}
        className="w-full resize-none rounded-lg border border-stone-200 p-3 focus:border-brand-500 focus:outline-none"
        {...form.register('content')}
      />
      <ImagePicker
        max={POST_MAX_IMAGES}
        onChange={setImageIds}
        onBusyChange={setUploading}
        resetSignal={resetSignal}
      />
      <div className="flex items-center justify-between text-sm">
        <span className={count > POST_MAX_CHARS ? 'text-red-600' : 'text-stone-500'}>
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
          className="rounded-lg bg-brand-500 px-4 py-1.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {t('post.submit')}
        </button>
      </div>
    </form>
  )
}
