import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, Upload } from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { getListGalleryQueryKey, useCreateGalleryItem } from '../../api/generated/gallery/gallery'
import { uploadImage } from '../../api/generated/images/images'
import type { Image } from '../../api/generated/model'
import { buttonClass, inputClass } from '../../components/ui'
import { useI18n } from '../../i18n/I18nProvider'
import type { MessageKey } from '../../i18n/messages'
import { useServerError } from '../../i18n/serverErrors'
import { checkImage, compressImage } from '../../lib/images'
import {
  charCount,
  GALLERY_CAPTION_MAX_CHARS,
  IMAGE_TYPES,
  VIDEO_MAX_BYTES,
  VIDEO_TYPES,
} from '../../lib/limits'
import { uploadVideo } from './uploadVideo'

type Phase = { kind: 'idle' } | { kind: 'uploading'; percent: number } | { kind: 'processing' }

const ACCEPT = [...IMAGE_TYPES, ...VIDEO_TYPES].join(',')

function checkVideo(file: File): MessageKey | null {
  if (!(VIDEO_TYPES as readonly string[]).includes(file.type)) return 'err.videoType'
  if (file.size > VIDEO_MAX_BYTES) return 'err.videoSize'
  return null
}

function imageProblem(file: File): MessageKey | null {
  const check = checkImage(file)
  return check.ok ? null : check.reason
}

/** Admin-only: upload one photo or video with a caption and publish it. */
export function GalleryUploader() {
  const { t } = useI18n()
  const serverError = useServerError()
  const qc = useQueryClient()
  const fileId = useId()
  const captionId = useId()
  const [file, setFile] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [inputKey, setInputKey] = useState(0) // remount to clear the file input
  const create = useCreateGalleryItem()

  const isVideo = file?.type.startsWith('video/') ?? false
  const busy = phase.kind !== 'idle'
  const captionLen = charCount(caption)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!file) return setError(t('err.fileRequired'))
    if (captionLen > GALLERY_CAPTION_MAX_CHARS) return setError(t('err.captionTooLong'))
    const invalid = isVideo ? checkVideo(file) : imageProblem(file)
    if (invalid) return setError(t(invalid))
    try {
      let mediaId: string
      if (isVideo) {
        setPhase({ kind: 'uploading', percent: 0 })
        const video = await uploadVideo(file, (f) => {
          const percent = Math.round(f * 100)
          // Upload done; server is remuxing + making the poster.
          setPhase(percent >= 100 ? { kind: 'processing' } : { kind: 'uploading', percent })
        })
        mediaId = video.id
      } else {
        setPhase({ kind: 'processing' })
        const res = await uploadImage({ file: await compressImage(file) })
        mediaId = (res.data as Image).id
      }
      setPhase({ kind: 'processing' })
      await create.mutateAsync({
        data: { kind: isVideo ? 'video' : 'photo', mediaId, caption: caption.trim() },
      })
      await qc.invalidateQueries({ queryKey: getListGalleryQueryKey() })
      toast.success(t('gallery.published'))
      setFile(null)
      setCaption('')
      setInputKey((k) => k + 1)
    } catch (err) {
      setError(serverError(err))
    } finally {
      setPhase({ kind: 'idle' })
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 rounded-2xl border-2 border-dashed border-brand-200 bg-white p-5 shadow-card sm:p-6"
      noValidate
    >
      <h2 className="flex items-center gap-2 text-lg font-semibold text-stone-900">
        <Plus className="size-5 text-brand-600" aria-hidden />
        {t('gallery.manage')}
      </h2>
      <div className="space-y-1">
        <label htmlFor={fileId} className="block text-sm font-medium text-stone-700">
          {t('gallery.chooseFile')}
        </label>
        <input
          key={inputKey}
          id={fileId}
          type="file"
          accept={ACCEPT}
          disabled={busy}
          onChange={(e) => {
            setError(null)
            setFile(e.target.files?.[0] ?? null)
          }}
          className="block w-full text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-brand-100 file:px-4 file:py-2 file:font-medium file:text-brand-700 hover:file:bg-brand-200"
        />
        <p className="text-xs text-stone-400">{t('gallery.fileHint')}</p>
      </div>
      <div className="space-y-1">
        <label htmlFor={captionId} className="block text-sm font-medium text-stone-700">
          {t('gallery.caption')}
        </label>
        <input
          id={captionId}
          value={caption}
          disabled={busy}
          onChange={(e) => setCaption(e.target.value)}
          className={inputClass}
        />
        <p
          className={`text-right text-xs ${captionLen > GALLERY_CAPTION_MAX_CHARS ? 'text-red-600' : 'text-stone-400'}`}
        >
          {captionLen}/{GALLERY_CAPTION_MAX_CHARS}
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className={buttonClass.primary}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="size-4" aria-hidden />
          )}
          {t('gallery.publish')}
        </button>
        {phase.kind === 'uploading' && (
          <div className="flex flex-1 items-center gap-2" role="status">
            <progress
              value={phase.percent}
              max={100}
              className="h-2 flex-1 overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-stone-100 [&::-webkit-progress-value]:bg-brand-500"
              aria-label={t('gallery.uploadingProgress', { percent: phase.percent })}
            />
            <span className="text-xs text-stone-500">
              {t('gallery.uploadingProgress', { percent: phase.percent })}
            </span>
          </div>
        )}
        {phase.kind === 'processing' && (
          <span role="status" className="text-xs text-stone-500">
            {t('gallery.processing')}
          </span>
        )}
      </div>
    </form>
  )
}
