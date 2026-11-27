import { useQueryClient } from '@tanstack/react-query'
import { Camera, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  getListGalleryQueryKey,
  useDeleteGalleryItem,
  useListGallery,
} from '../../api/generated/gallery/gallery'
import type { GalleryItem } from '../../api/generated/model'
import { errorMessage } from '../../api/http'
import { EmptyState } from '../../components/ui'
import { useI18n } from '../../i18n/I18nProvider'
import { useServerError } from '../../i18n/serverErrors'
import { TimeAgo } from '../community/TimeAgo'
import { Lightbox, useLightbox } from '../images/Lightbox'

export function GalleryGrid({ canManage }: { canManage: boolean }) {
  const { t } = useI18n()
  const { data: items, error } = useListGallery({
    query: { select: (res) => res.data as GalleryItem[] },
  })
  const viewer = useLightbox()

  if (error) return <p className="text-red-600">{errorMessage(error)}</p>
  if (!items) return <p className="text-stone-500">{t('post.loading')}</p>
  if (items.length === 0) return <EmptyState icon={Camera}>{t('gallery.empty')}</EmptyState>

  // The viewer pages through photos only; videos play inline.
  const photos = items
    .filter((it) => it.kind === 'photo')
    .map((it) => ({ src: it.url, alt: it.caption || t('gallery.photo') }))

  return (
    <>
      <ul
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        aria-label={t('gallery.list')}
      >
        {items.map((it) => (
          <GalleryCard
            key={it.id}
            item={it}
            canManage={canManage}
            onOpenPhoto={() => viewer.open(photos.findIndex((p) => p.src === it.url))}
          />
        ))}
      </ul>
      {viewer.index !== null && (
        <Lightbox
          images={photos}
          index={viewer.index}
          onIndexChange={viewer.setIndex}
          onClose={viewer.close}
        />
      )}
    </>
  )
}

function GalleryCard({
  item,
  canManage,
  onOpenPhoto,
}: {
  item: GalleryItem
  canManage: boolean
  onOpenPhoto: () => void
}) {
  const { t } = useI18n()
  const serverError = useServerError()
  const qc = useQueryClient()
  const del = useDeleteGalleryItem({
    mutation: {
      onSuccess: () => {
        toast.success(t('gallery.deleted'))
        return qc.invalidateQueries({ queryKey: getListGalleryQueryKey() })
      },
      onError: (err) => toast.error(serverError(err)),
    },
  })
  const label = item.caption || t(item.kind === 'video' ? 'gallery.video' : 'gallery.photo')

  return (
    <li
      className="group overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-stone-100 transition hover:-translate-y-0.5 hover:shadow-lift"
      aria-label={label}
    >
      {/* Reserve space from known dimensions so the grid doesn't jump. */}
      <div
        className="overflow-hidden bg-stone-100"
        style={{ aspectRatio: `${item.width} / ${item.height}` }}
      >
        {item.kind === 'video' ? (
          // biome-ignore lint/a11y/useMediaCaption: user cat clips have no captions track
          <video
            src={item.url}
            poster={item.posterUrl}
            controls
            preload="none"
            playsInline
            className="size-full object-contain"
          />
        ) : (
          <button
            type="button"
            onClick={onOpenPhoto}
            className="block size-full"
            aria-haspopup="dialog"
          >
            <img
              src={item.url}
              alt={label}
              loading="lazy"
              className="size-full object-cover transition duration-300 group-hover:scale-[1.02]"
            />
          </button>
        )}
      </div>
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          {item.caption && <p className="break-words text-sm">{item.caption}</p>}
          <p className="text-xs text-stone-400">
            <TimeAgo iso={item.createdAt} />
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            disabled={del.isPending}
            onClick={() => {
              if (window.confirm(t('gallery.deleteConfirm'))) del.mutate({ itemId: item.id })
            }}
            aria-label={`${t('gallery.delete')} ${label}`}
            className="rounded-md p-1 text-stone-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        )}
      </div>
    </li>
  )
}
