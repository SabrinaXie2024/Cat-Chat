import { formatDistanceToNow } from 'date-fns'
import { useI18n } from '../../i18n/I18nProvider'

export function TimeAgo({ iso }: { iso: string }) {
  const { lang, dateLocale } = useI18n()
  const d = new Date(iso)
  return (
    <time dateTime={iso} title={d.toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US')}>
      {formatDistanceToNow(d, { addSuffix: true, locale: dateLocale })}
    </time>
  )
}
