import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'

export function TimeAgo({ iso }: { iso: string }) {
  const d = new Date(iso)
  return (
    <time dateTime={iso} title={d.toLocaleString('zh-CN')}>
      {formatDistanceToNow(d, { addSuffix: true, locale: zhCN })}
    </time>
  )
}
