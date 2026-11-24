import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { getListPostsQueryKey, useCreatePost } from '../../api/generated/posts/posts'
import { errorMessage } from '../../api/http'
import { charCount, POST_MAX_CHARS } from '../../lib/limits'

const schema = z.object({
  content: z
    .string()
    .refine((s) => charCount(s) > 0, '写点什么吧')
    .refine((s) => charCount(s) <= POST_MAX_CHARS, `最多 ${POST_MAX_CHARS} 字`),
})
type Values = z.infer<typeof schema>

export function NewPostForm() {
  const qc = useQueryClient()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { content: '' } })
  const create = useCreatePost({
    mutation: {
      onSuccess: () => {
        form.reset()
        toast.success('发布成功')
        return qc.invalidateQueries({ queryKey: getListPostsQueryKey() })
      },
      onError: (err) => toast.error(errorMessage(err)),
    },
  })
  const count = charCount(form.watch('content'))

  return (
    <form
      onSubmit={form.handleSubmit((v) =>
        create.mutate({ data: { content: v.content, images: [] } }),
      )}
      className="space-y-2 rounded-xl bg-white p-4 shadow-sm"
    >
      <label htmlFor="content" className="sr-only">
        分享你的猫咪日常
      </label>
      <textarea
        id="content"
        rows={3}
        placeholder="分享你的猫咪日常…"
        className="w-full resize-none rounded-lg border border-stone-200 p-3 focus:border-brand-500 focus:outline-none"
        {...form.register('content')}
      />
      <div className="flex items-center justify-between text-sm">
        <span className={count > POST_MAX_CHARS ? 'text-red-600' : 'text-stone-500'}>
          {count}/{POST_MAX_CHARS}
          {form.formState.errors.content && (
            <span role="alert" className="ml-2 text-red-600">
              {form.formState.errors.content.message}
            </span>
          )}
        </span>
        <button
          type="submit"
          disabled={create.isPending}
          className="rounded-lg bg-brand-500 px-4 py-1.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          发布
        </button>
      </div>
    </form>
  )
}
