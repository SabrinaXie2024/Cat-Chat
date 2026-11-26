/** Read-only thumbnails for a post or reply; each opens the full image. */
export function ImageGrid({ urls, compact = false }: { urls: string[]; compact?: boolean }) {
  if (urls.length === 0) return null
  const size = compact ? 'size-16' : 'size-28 sm:size-32'
  return (
    <ul className="mt-2 flex flex-wrap gap-2" aria-label="图片">
      {urls.map((url, i) => (
        <li key={url}>
          <a href={url} target="_blank" rel="noopener noreferrer" className="block">
            <img
              src={url}
              alt={`图片 ${i + 1}`}
              loading="lazy"
              className={`${size} rounded-lg bg-stone-100 object-cover hover:opacity-90`}
            />
          </a>
        </li>
      ))}
    </ul>
  )
}
