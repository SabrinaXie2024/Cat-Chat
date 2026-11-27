import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useI18n } from '../../i18n/I18nProvider'

export type LightboxImage = { src: string; alt: string }

/**
 * Full-screen image viewer: Esc / backdrop / × to close, ←/→ and on-screen
 * buttons to page, swipe on touch screens. Locks page scroll, moves focus in
 * and restores it on close, and keeps Tab inside the dialog.
 */
export function Lightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: LightboxImage[]
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [loaded, setLoaded] = useState(false)
  const touchX = useRef<number | null>(null)
  const count = images.length
  const current = images[index]
  const many = count > 1

  const go = useCallback(
    (delta: number) => {
      if (!many) return
      setLoaded(false)
      onIndexChange((index + delta + count) % count)
    },
    [index, count, many, onIndexChange],
  )

  // Focus management + scroll lock.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [])

  // Keyboard: Esc, arrows, and a simple focus trap.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key === 'Tab') {
        const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button, a[href]')
        if (!focusable?.length) return
        const first = focusable[0] as HTMLElement
        const last = focusable[focusable.length - 1] as HTMLElement
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [go, onClose])

  // Preload neighbours so paging feels instant.
  useEffect(() => {
    if (!many) return
    for (const d of [-1, 1]) {
      const next = images[(index + d + count) % count]
      if (next) new Image().src = next.src
    }
  }, [index, images, count, many])

  if (!current) return null

  const navButton =
    'absolute top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/25 focus-visible:outline-white'

  return createPortal(
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a mouse shortcut; Esc (document listener) and the close button cover keyboard users
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('lightbox.label')}
      className="fixed inset-0 z-[60] flex flex-col bg-stone-950/90 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null
      }}
      onTouchEnd={(e) => {
        const start = touchX.current
        const end = e.changedTouches[0]?.clientX
        touchX.current = null
        if (start == null || end == null) return
        const dx = end - start
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1)
      }}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3 text-sm text-white/80">
        <span aria-live="polite">
          {many ? t('lightbox.counter', { n: index + 1, total: count }) : ''}
        </span>
        <div className="flex items-center gap-1">
          <a
            href={current.src}
            target="_blank"
            rel="noopener noreferrer"
            className="grid size-10 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-white"
            aria-label={t('lightbox.original')}
            title={t('lightbox.original')}
          >
            <ExternalLink className="size-5" aria-hidden />
          </a>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="grid size-10 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-white"
            aria-label={t('lightbox.close')}
            title={t('lightbox.close')}
          >
            <X className="size-6" aria-hidden />
          </button>
        </div>
      </div>

      {/* Clicking around the image closes (mouse convenience; keyboard has Esc). */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: see above — keyboard users close with Esc or the close button */}
      <div
        role="presentation"
        className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6 sm:px-16"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        {!loaded && (
          <span
            className="absolute size-8 animate-spin rounded-full border-2 border-white/20 border-t-white"
            aria-hidden
          />
        )}
        <img
          key={current.src}
          src={current.src}
          alt={current.alt}
          onLoad={() => setLoaded(true)}
          className={`max-h-full max-w-full select-none rounded-lg object-contain shadow-2xl transition-opacity duration-200 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
          draggable={false}
        />
        {many && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              className={`${navButton} left-2 sm:left-4`}
              aria-label={t('lightbox.prev')}
            >
              <ChevronLeft className="size-6" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              className={`${navButton} right-2 sm:right-4`}
              aria-label={t('lightbox.next')}
            >
              <ChevronRight className="size-6" aria-hidden />
            </button>
          </>
        )}
      </div>

      {many && (
        <div className="flex justify-center gap-2 overflow-x-auto px-4 pb-4">
          {images.map((img, i) => (
            <button
              key={img.src}
              type="button"
              onClick={() => {
                setLoaded(false)
                onIndexChange(i)
              }}
              aria-label={t('lightbox.counter', { n: i + 1, total: count })}
              aria-current={i === index ? 'true' : undefined}
              className={`size-12 shrink-0 overflow-hidden rounded-md ring-2 transition ${
                i === index ? 'ring-white' : 'opacity-60 ring-transparent hover:opacity-100'
              }`}
            >
              <img src={img.src} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  )
}

/** State helper: `open(i)` shows the viewer at image i. */
export function useLightbox() {
  const [index, setIndex] = useState<number | null>(null)
  return {
    index,
    open: (i: number) => setIndex(i),
    close: () => setIndex(null),
    setIndex: (i: number) => setIndex(i),
  }
}
