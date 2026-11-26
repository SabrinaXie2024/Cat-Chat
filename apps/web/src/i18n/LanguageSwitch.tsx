import { Languages } from 'lucide-react'
import { useI18n } from './I18nProvider'

export function LanguageSwitch() {
  const { lang, setLang, t } = useI18n()
  return (
    <button
      type="button"
      onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
      aria-label={t('lang.switchLabel')}
      title={t('lang.switchLabel')}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-stone-600 hover:bg-stone-100 hover:text-stone-900"
    >
      <Languages className="size-4" aria-hidden />
      {t('lang.switchTo')}
    </button>
  )
}
