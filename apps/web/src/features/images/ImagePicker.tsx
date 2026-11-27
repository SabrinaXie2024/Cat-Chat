import { ImagePlus, Loader2, X } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { uploadImage } from '../../api/generated/images/images'
import type { Image } from '../../api/generated/model'
import { errorMessage } from '../../api/http'
import { useI18n } from '../../i18n/I18nProvider'
import { useServerError } from '../../i18n/serverErrors'
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
  const { t } = useI18n()
  const serverError = useServerError()
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
    if (files.length > room) setError(t('images.tooMany', { max }))

    await Promise.all(
      files.slice(0, Math.max(room, 0)).map(async (file) => {
        const check = checkImage(file)
        if (!check.ok) {
          setError(t(check.reason))
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

  function uploadErrorText(err: unknown) {
    const text = serverError(err)
    // Known errors are already translated; wrap unknown ones.
    return text === errorMessage(err) ? t('err.uploadFailed', { msg: text }) : text
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
      <ul className="flex flex-wrap gap-2" aria-label={t('images.picked')}>
        {items.map((it, i) => (
          <li key={it.key} className={`relative ${size} overflow-hidden rounded-xl bg-stone-100`}>
            <img
              src={it.preview}
              alt={t('images.alt', { n: i + 1 })}
              className="size-full object-cover"
            />
            {it.status === 'uploading' ? (
              <span className="absolute inset-0 grid place-items-center bg-white/60" role="status">
                <Loader2 className="size-5 animate-spin text-stone-600" aria-hidden />
                <span className="sr-only">{t('images.uploading')}</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => remove(it.key)}
                aria-label={t('images.remove', { n: i + 1 })}
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
              className={`${size} grid cursor-pointer place-items-center rounded-xl border-2 border-dashed border-brand-200 bg-brand-50/50 text-stone-400 hover:border-brand-500 hover:text-brand-500`}
            >
              <ImagePlus className="size-5" aria-hidden />
              <span className="sr-only">{t('images.add', { max })}</span>
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
        {t('images.hint', { count: items.length, max })}
        {error && (
          <span role="alert" className="ml-2 text-red-600">
            {error}
          </span>
        )}
      </p>
    </div>
  )
}
