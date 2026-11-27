import { useI18n } from '../../i18n/I18nProvider'
import { Lightbox, useLightbox } from './Lightbox'

/** Read-only thumbnails for a post or reply; each opens the in-page viewer. */
export function ImageGrid({ urls, compact = false }: { urls: string[]; compact?: boolean }) {
  const { t } = useI18n()
  const viewer = useLightbox()
  if (urls.length === 0) return null
  const size = compact ? 'size-16' : 'size-28 sm:size-32'
  const images = urls.map((src, i) => ({ src, alt: t('images.gridAlt', { n: i + 1 }) }))
  return (
    <>
      <ul className="mt-2 flex flex-wrap gap-2" aria-label={t('images.grid')}>
        {images.map((img, i) => (
          <li key={img.src}>
            <button
              type="button"
              onClick={() => viewer.open(i)}
              className="block overflow-hidden rounded-xl"
              aria-haspopup="dialog"
            >
              <img
                src={img.src}
                alt={img.alt}
                loading="lazy"
                className={`${size} rounded-xl bg-stone-100 object-cover ring-1 ring-stone-100 transition hover:scale-[1.03] hover:opacity-95`}
              />
            </button>
          </li>
        ))}
      </ul>
      {viewer.index !== null && (
        <Lightbox
          images={images}
          index={viewer.index}
          onIndexChange={viewer.setIndex}
          onClose={viewer.close}
        />
      )}
    </>
  )
}
