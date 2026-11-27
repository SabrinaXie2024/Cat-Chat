import { useI18n } from '../../i18n/I18nProvider'

/** Read-only thumbnails for a post or reply; each opens the full image. */
export function ImageGrid({ urls, compact = false }: { urls: string[]; compact?: boolean }) {
  const { t } = useI18n()
  if (urls.length === 0) return null
  const size = compact ? 'size-16' : 'size-28 sm:size-32'
  return (
    <ul className="mt-2 flex flex-wrap gap-2" aria-label={t('images.grid')}>
      {urls.map((url, i) => (
        <li key={url}>
          <a href={url} target="_blank" rel="noopener noreferrer" className="block">
            <img
              src={url}
              alt={t('images.gridAlt', { n: i + 1 })}
              loading="lazy"
              className={`${size} rounded-xl bg-stone-100 object-cover ring-1 ring-stone-100 transition hover:opacity-90`}
            />
          </a>
        </li>
      ))}
    </ul>
  )
}
