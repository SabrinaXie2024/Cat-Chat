import { ImagePlus, Loader2, X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { uploadImage } from '../../api/generated/images/images'
import type { Image } from '../../api/generated/model'
import { errorMessage } from '../../api/http'
import { checkImage, compressImage } from '../../lib/images'
import { IMAGE_TYPES } from '../../lib/limits'

type Item =
  | { key: string; status: 'uploading'; preview: string }
  | { key: string; status: 'done'; preview: string; image: Image }

let seq = 0

/**
 * Pick → validate → compress in the browser → upload, one request per file.
 * Reports uploaded image ids via onChange and busy state via onBusyChange so
 * the parent form can disable submit while uploads are in flight.
 */
export function ImagePicker({
  max,
  onChange,
  onBusyChange,
  resetSignal,
  compact = false,
}: {
  max: number
  onChange: (ids: string[]) => void
  onBusyChange?: (busy: boolean) => void
  /** Change this value to clear the picker (e.g. after a successful submit). */
  resetSignal?: unknown
  compact?: boolean
}) {
  const [items, setItems] = useState<Item[]>([])
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetSignal is the trigger
  useEffect(() => {
    setItems((prev) => {
      for (const it of prev) URL.revokeObjectURL(it.preview)
      return []
    })
    setError(null)
  }, [resetSignal])

  useEffect(() => {
    onChange(items.flatMap((it) => (it.status === 'done' ? [it.image.id] : [])))
    onBusyChange?.(items.some((it) => it.status === 'uploading'))
  }, [items, onChange, onBusyChange])

  async function addFiles(files: File[]) {
    if (files.length === 0) return
    setError(null)
    const room = max - items.length
    if (files.length > room) setError(`最多 ${max} 张图片`)

    await Promise.all(
      files.slice(0, Math.max(room, 0)).map(async (file) => {
        const check = checkImage(file)
        if (!check.ok) {
          setError(check.reason)
          return
        }
        const key = `img-${++seq}`
        const preview = URL.createObjectURL(file)
        setItems((prev) => [...prev, { key, status: 'uploading', preview }])
        try {
          const compressed = await compressImage(file)
          const res = await uploadImage({ file: compressed })
          const image = res.data as Image
          setItems((prev) =>
            prev.map((it) => (it.key === key ? { key, status: 'done', preview, image } : it)),
          )
        } catch (err) {
          URL.revokeObjectURL(preview)
          setItems((prev) => prev.filter((it) => it.key !== key))
          setError(uploadErrorText(err))
        }
      }),
    )
  }

  function remove(key: string) {
    setItems((prev) => {
      const it = prev.find((i) => i.key === key)
      if (it) URL.revokeObjectURL(it.preview)
      return prev.filter((i) => i.key !== key)
    })
  }

  const size = compact ? 'size-14' : 'size-20'

  return (
    <div className="space-y-1">
      <ul className="flex flex-wrap gap-2" aria-label="已选图片">
        {items.map((it, i) => (
          <li key={it.key} className={`relative ${size} overflow-hidden rounded-lg bg-stone-100`}>
            <img src={it.preview} alt={`第 ${i + 1} 张图片`} className="size-full object-cover" />
            {it.status === 'uploading' ? (
              <span className="absolute inset-0 grid place-items-center bg-white/60" role="status">
                <Loader2 className="size-5 animate-spin text-stone-600" aria-hidden />
                <span className="sr-only">上传中</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => remove(it.key)}
                aria-label={`移除第 ${i + 1} 张图片`}
                className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </li>
        ))}
        {items.length < max && (
          <li>
            <label
              htmlFor={inputId}
              className={`${size} grid cursor-pointer place-items-center rounded-lg border-2 border-dashed border-stone-300 text-stone-400 hover:border-brand-500 hover:text-brand-500`}
            >
              <ImagePlus className="size-5" aria-hidden />
              <span className="sr-only">添加图片（最多 {max} 张）</span>
            </label>
            <input
              id={inputId}
              type="file"
              accept={IMAGE_TYPES.join(',')}
              multiple
              className="sr-only"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? [])
                e.target.value = '' // allow re-picking the same file
                void addFiles(files)
              }}
            />
          </li>
        )}
      </ul>
      <p className="text-xs text-stone-400">
        {items.length}/{max} 张 · JPG/PNG/WebP，每张不超过 5MB
        {error && (
          <span role="alert" className="ml-2 text-red-600">
            {error}
          </span>
        )}
      </p>
    </div>
  )
}

function uploadErrorText(err: unknown) {
  const msg = errorMessage(err)
  if (msg.includes('JPEG, PNG and WebP')) return '只支持 JPG、PNG、WebP 格式'
  if (msg.includes('5 MB') || msg.includes('(413)')) return '单张图片不能超过 5MB'
  if (msg.includes('dimensions')) return '图片尺寸太大'
  if (msg.includes('could not read')) return '图片文件已损坏，无法读取'
  if (msg.startsWith('please sign in')) return '登录已过期，请重新登录'
  return `上传失败：${msg}`
}
