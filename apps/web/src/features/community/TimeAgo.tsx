import { formatDistanceToNow } from 'date-fns'
import { useI18n } from '../../i18n/I18nProvider'
import { languageInfo } from '../../i18n/languages'

export function TimeAgo({ iso }: { iso: string }) {
  const { lang, dateLocale } = useI18n()
  const d = new Date(iso)
  return (
    <time dateTime={iso} title={d.toLocaleString(languageInfo(lang).htmlLang)}>
      {formatDistanceToNow(d, { addSuffix: true, locale: dateLocale })}
    </time>
  )
}
