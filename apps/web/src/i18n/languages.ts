import type { Locale } from 'date-fns'
import {
  de as deDF,
  enUS,
  es as esDF,
  fr as frDF,
  ja as jaDF,
  ko as koDF,
  ptBR,
  ru as ruDF,
  zhCN,
  zhTW as zhTWDF,
} from 'date-fns/locale'
import { de } from './locales/de'
import { es } from './locales/es'
import { fr } from './locales/fr'
import { ja } from './locales/ja'
import { ko } from './locales/ko'
import { pt } from './locales/pt'
import { ru } from './locales/ru'
import { zhTW } from './locales/zh-TW'
import { en, type Messages, zh } from './messages'

export type Lang = 'zh' | 'zh-TW' | 'en' | 'ja' | 'ko' | 'ru' | 'fr' | 'de' | 'es' | 'pt'

type LanguageInfo = {
  code: Lang
  /** Shown in the picker in its own script, so people can find their language. */
  nativeName: string
  htmlLang: string
  dateLocale: Locale
  messages: Messages
}

export const LANGUAGES: readonly LanguageInfo[] = [
  { code: 'zh', nativeName: '简体中文', htmlLang: 'zh-CN', dateLocale: zhCN, messages: zh },
  { code: 'zh-TW', nativeName: '繁體中文', htmlLang: 'zh-TW', dateLocale: zhTWDF, messages: zhTW },
  { code: 'en', nativeName: 'English', htmlLang: 'en', dateLocale: enUS, messages: en },
  { code: 'ja', nativeName: '日本語', htmlLang: 'ja', dateLocale: jaDF, messages: ja },
  { code: 'ko', nativeName: '한국어', htmlLang: 'ko', dateLocale: koDF, messages: ko },
  { code: 'ru', nativeName: 'Русский', htmlLang: 'ru', dateLocale: ruDF, messages: ru },
  { code: 'fr', nativeName: 'Français', htmlLang: 'fr', dateLocale: frDF, messages: fr },
  { code: 'de', nativeName: 'Deutsch', htmlLang: 'de', dateLocale: deDF, messages: de },
  { code: 'es', nativeName: 'Español', htmlLang: 'es', dateLocale: esDF, messages: es },
  { code: 'pt', nativeName: 'Português', htmlLang: 'pt-BR', dateLocale: ptBR, messages: pt },
]

export const languageInfo = (code: Lang): LanguageInfo =>
  LANGUAGES.find((l) => l.code === code) ?? (LANGUAGES[0] as LanguageInfo)

export const isLang = (v: unknown): v is Lang => LANGUAGES.some((l) => l.code === v)

/** Map a BCP 47 tag (e.g. "zh-Hant-HK", "pt-PT", "ja-JP") to a supported language. */
export function matchLang(tag: string): Lang | undefined {
  const t = tag.toLowerCase()
  if (t.startsWith('zh')) {
    return /hant|-tw|-hk|-mo/.test(t) ? 'zh-TW' : 'zh'
  }
  const base = t.split('-')[0]
  return LANGUAGES.find((l) => l.code === base)?.code
}
