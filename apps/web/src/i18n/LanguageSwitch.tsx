import { Check, ChevronDown, Languages } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useI18n } from './I18nProvider'
import { LANGUAGES, languageInfo } from './languages'

/** Accessible language picker (menu of radio items, Escape/outside-click close). */
export function LanguageSwitch() {
  const { lang, setLang, t, followingSystem, systemLang, followSystem } = useI18n()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`${t('lang.label')}: ${languageInfo(lang).nativeName}`}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 hover:text-stone-900"
      >
        <Languages className="size-4" aria-hidden />
        <span>{languageInfo(lang).nativeName}</span>
        <ChevronDown
          className={`size-4 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={t('lang.label')}
          className="absolute right-0 z-20 mt-1 max-h-96 w-44 overflow-y-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitemradio"
            aria-checked={followingSystem}
            onClick={() => {
              followSystem()
              setOpen(false)
              buttonRef.current?.focus()
            }}
            className="flex w-full items-center justify-between gap-2 border-b border-stone-100 px-3 py-1.5 text-left text-sm text-stone-700 hover:bg-stone-100 focus:bg-stone-100 focus:outline-none"
          >
            <span>
              {t('lang.system')}
              <span
                className="block text-xs text-stone-400"
                lang={languageInfo(systemLang).htmlLang}
              >
                {languageInfo(systemLang).nativeName}
              </span>
            </span>
            {followingSystem && <Check className="size-4 shrink-0 text-brand-700" aria-hidden />}
          </button>
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              role="menuitemradio"
              aria-checked={!followingSystem && l.code === lang}
              lang={l.htmlLang}
              onClick={() => {
                setLang(l.code)
                setOpen(false)
                buttonRef.current?.focus()
              }}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm text-stone-700 hover:bg-stone-100 focus:bg-stone-100 focus:outline-none"
            >
              {l.nativeName}
              {!followingSystem && l.code === lang && (
                <Check className="size-4 text-brand-700" aria-hidden />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
