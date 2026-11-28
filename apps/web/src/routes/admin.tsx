import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Check, Flag, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  getListReportsQueryKey,
  resolveReports,
  useListReports,
} from '../api/generated/admin/admin'
import type { ReportedReply, ReportResolutionAction } from '../api/generated/model'
import { errorMessage } from '../api/http'
import { CatAvatar } from '../components/CatAvatar'
import { buttonClass, Card, EmptyState, PageHero } from '../components/ui'
import { useCurrentUser } from '../features/auth/useCurrentUser'
import { TimeAgo } from '../features/community/TimeAgo'
import { ImageGrid } from '../features/images/ImageGrid'
import { useI18n } from '../i18n/I18nProvider'
import { useServerError } from '../i18n/serverErrors'

export const Route = createFileRoute('/admin')({ component: AdminPage })

function AdminPage() {
  const { t } = useI18n()
  const { data: user } = useCurrentUser()
  if (user === undefined) return null
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHero icon={ShieldCheck} title={t('admin.title')} subtitle={t('admin.subtitle')} />
      {user === null ? (
        <p className="text-stone-600">
          <Link to="/login" search={{ redirect: '/admin' }} className={buttonClass.link}>
            {t('auth.login')}
          </Link>
        </p>
      ) : !user.isAdmin ? (
        <EmptyState icon={ShieldOff}>{t('admin.forbidden')}</EmptyState>
      ) : (
        <ReportQueue />
      )}
    </div>
  )
}

function ReportQueue() {
  const { t } = useI18n()
  const { data, error } = useListReports({
    query: { select: (res) => res.data as ReportedReply[] },
  })
  if (error) return <p className="text-red-600">{errorMessage(error)}</p>
  if (!data) return <p className="text-stone-500">{t('admin.loading')}</p>
  if (data.length === 0) return <EmptyState icon={Check}>{t('admin.empty')}</EmptyState>
  return (
    <ul className="space-y-4">
      {data.map((item) => (
        <ReportCard key={item.reply.id} item={item} />
      ))}
    </ul>
  )
}

function ReportCard({ item }: { item: ReportedReply }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const serverError = useServerError()
  const [busy, setBusy] = useState(false)
  const r = item.reply

  async function resolve(action: ReportResolutionAction) {
    if (action === 'delete' && !window.confirm(t('admin.deleteConfirm'))) return
    setBusy(true)
    try {
      await resolveReports(r.id, { action })
      toast.success(t(action === 'delete' ? 'admin.deleted' : 'admin.dismissed'))
      await qc.invalidateQueries({ queryKey: getListReportsQueryKey() })
      // The thread (and reply counts) changed for everyone.
      if (action === 'delete') void qc.invalidateQueries()
    } catch (err) {
      toast.error(serverError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card as="li" className="space-y-4" aria-label={t('post.cardLabel', { author: r.author })}>
      <div className="flex items-start gap-3">
        <CatAvatar avatar={r.authorAvatar} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 text-sm">
            <Link
              to="/users/$userId"
              params={{ userId: r.authorId }}
              className="font-medium text-stone-900 hover:text-brand-700"
            >
              {r.author}
            </Link>
            <span className="text-xs text-stone-400">
              <TimeAgo iso={r.createdAt} />
            </span>
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
              <Flag className="size-3" aria-hidden />
              {t('admin.reportCount', { n: item.reports.length })}
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-stone-800">{r.content}</p>
          <ImageGrid urls={r.images} compact />
          <p className="mt-2 truncate text-xs text-stone-400">
            {t('admin.inPost', { excerpt: item.postExcerpt })}
          </p>
        </div>
      </div>

      <ul
        aria-label={t('admin.reportsLabel')}
        className="space-y-1.5 rounded-xl bg-stone-50 p-3 text-sm"
      >
        {item.reports.map((rep) => (
          <li key={rep.reporter.id} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-stone-700">{rep.reporter.nickname}</span>
            <span className="rounded bg-white px-1.5 text-xs text-stone-600 ring-1 ring-stone-200">
              {t(`reply.reason.${rep.reason}`)}
            </span>
            {rep.note && <span className="break-words text-stone-600">{rep.note}</span>}
            <span className="ml-auto text-xs text-stone-400">
              <TimeAgo iso={rep.createdAt} />
            </span>
          </li>
        ))}
      </ul>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className={buttonClass.secondary}
          disabled={busy}
          onClick={() => resolve('dismiss')}
        >
          <Check className="size-4" aria-hidden />
          {t('admin.dismiss')}
        </button>
        <button
          type="button"
          className={`${buttonClass.primary} bg-red-600 hover:bg-red-700 active:bg-red-800`}
          disabled={busy}
          onClick={() => resolve('delete')}
        >
          <Trash2 className="size-4" aria-hidden />
          {t('admin.deleteReply')}
        </button>
      </div>
    </Card>
  )
}
