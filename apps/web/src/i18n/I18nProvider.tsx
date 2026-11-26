import type { Locale } from 'date-fns'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  GALLERY_CAPTION_MAX_CHARS,
  MAX_REPLIES_PER_POST,
  NICKNAME_MAX_CHARS,
  PASSWORD_MAX_CHARS,
  PASSWORD_MIN_CHARS,
  POST_MAX_CHARS,
  REPLY_MAX_CHARS,
} from '../lib/limits'
import { isLang, type Lang, languageInfo, matchLang } from './languages'
import type { MessageKey } from './messages'

export type { Lang } from './languages'

const STORAGE_KEY = 'lang'

/** Product limits, available to every message as {postMax} etc. */
const limitVars = {
  postMax: POST_MAX_CHARS,
  replyMax: REPLY_MAX_CHARS,
  maxReplies: MAX_REPLIES_PER_POST,
  nicknameMax: NICKNAME_MAX_CHARS,
  passwordMin: PASSWORD_MIN_CHARS,
  passwordMax: PASSWORD_MAX_CHARS,
  captionMax: GALLERY_CAPTION_MAX_CHARS,
}

type Vars = Record<string, string | number>
export type T = (key: MessageKey, vars?: Vars) => string

type Ctx = { lang: Lang; setLang: (l: Lang) => void; t: T; dateLocale: Locale }
const I18nContext = createContext<Ctx | null>(null)

/** Saved choice → first supported browser language → English. */
export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isLang(saved)) return saved
  } catch {
    // storage blocked (private mode etc.) — fall through
  }
  const prefs =
    typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language])
  for (const tag of prefs) {
    const lang = tag ? matchLang(tag) : undefined
    if (lang) return lang
  }
  return 'en'
}

export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  const all: Vars = { ...limitVars, ...vars }
  return languageInfo(lang).messages[key].replace(/\{(\w+)\}/g, (m, name: string) =>
    name in all ? String(all[name]) : m,
  )
}

export function I18nProvider({
  children,
  initialLang,
}: {
  children: ReactNode
  initialLang?: Lang
}) {
  const [lang, setLangState] = useState<Lang>(() => initialLang ?? detectLang())

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      // not persisted; still switches for this visit
    }
  }, [])

  useEffect(() => {
    const info = languageInfo(lang)
    document.documentElement.lang = info.htmlLang
    document.title = info.messages.docTitle
  }, [lang])

  const value = useMemo<Ctx>(
    () => ({
      lang,
      setLang,
      t: (key, vars) => translate(lang, key, vars),
      dateLocale: languageInfo(lang).dateLocale,
    }),
    [lang, setLang],
  )
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}

/**
 * Zod schemas carry message *keys* (so they can live at module scope);
 * translate them at render time with this.
 */
export function useFieldError() {
  const { t } = useI18n()
  return (message: string | undefined) => (message ? t(message as MessageKey) : undefined)
}
