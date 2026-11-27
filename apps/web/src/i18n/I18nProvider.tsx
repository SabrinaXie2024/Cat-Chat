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

type Ctx = {
  lang: Lang
  /** Pin a language (saved). */
  setLang: (l: Lang) => void
  /** True when no language is pinned and the system language is used. */
  followingSystem: boolean
  systemLang: Lang
  /** Forget the pinned language and follow the system again. */
  followSystem: () => void
  t: T
  dateLocale: Locale
}
const I18nContext = createContext<Ctx | null>(null)

/** First supported language in the browser/OS preference list, else English. */
export function systemLang(): Lang {
  const prefs =
    typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language])
  for (const tag of prefs) {
    const lang = tag ? matchLang(tag) : undefined
    if (lang) return lang
  }
  return 'en'
}

function savedLang(): Lang | undefined {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return isLang(saved) ? saved : undefined
  } catch {
    return undefined // storage blocked (private mode etc.)
  }
}

/** Saved choice → system language → English. */
export function detectLang(): Lang {
  return savedLang() ?? systemLang()
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
  // No saved choice = follow the system language (and its later changes).
  const [chosen, setChosen] = useState<Lang | undefined>(() => initialLang ?? savedLang())
  const [system, setSystem] = useState<Lang>(systemLang)
  const lang = chosen ?? system

  useEffect(() => {
    const onChange = () => setSystem(systemLang())
    window.addEventListener('languagechange', onChange)
    return () => window.removeEventListener('languagechange', onChange)
  }, [])

  const setLang = useCallback((l: Lang) => {
    setChosen(l)
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      // not persisted; still switches for this visit
    }
  }, [])

  const followSystem = useCallback(() => {
    setChosen(undefined)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // nothing saved to clear
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
      followingSystem: chosen === undefined,
      systemLang: system,
      followSystem,
      t: (key, vars) => translate(lang, key, vars),
      dateLocale: languageInfo(lang).dateLocale,
    }),
    [lang, chosen, system, setLang, followSystem],
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
