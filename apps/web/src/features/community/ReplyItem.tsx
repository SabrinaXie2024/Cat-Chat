import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Flag, Pin, PinOff, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import type { Post, Reply, ReportReason } from '../../api/generated/model'
import {
  deleteReply,
  getListPostsQueryKey,
  getListRepliesQueryKey,
  pinReply,
  reportReply,
  unpinReply,
} from '../../api/generated/posts/posts'
import { CatAvatar } from '../../components/CatAvatar'
import { buttonClass, inputClass } from '../../components/ui'
import { useI18n } from '../../i18n/I18nProvider'
import type { MessageKey } from '../../i18n/messages'
import { useServerError } from '../../i18n/serverErrors'
import { charCount } from '../../lib/limits'
import { useCurrentUser } from '../auth/useCurrentUser'
import { ImageGrid } from '../images/ImageGrid'
import { TimeAgo } from './TimeAgo'

const REPORT_NOTE_MAX = 200
const REASONS: ReportReason[] = ['spam', 'abuse', 'inappropriate', 'other']

const iconButton =
  'grid size-7 place-items-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-50'

/**
 * One reply. The post's author gets pin and delete; any other signed-in
 * user (except the reply's author) gets report.
 */
export function ReplyItem({ reply: r, post }: { reply: Reply; post: Post }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const serverError = useServerError()
  const { data: me } = useCurrentUser()
  const [busy, setBusy] = useState(false)
  const [reporting, setReporting] = useState(false)

  const isPostAuthor = !!me && me.id === post.authorId
  const canReport = !!me && me.id !== r.authorId

  async function run(action: () => Promise<unknown>, done?: MessageKey, refreshPosts = false) {
    setBusy(true)
    try {
      await action()
      if (done) toast.success(t(done))
      await qc.invalidateQueries({ queryKey: getListRepliesQueryKey(post.id) })
      // Deleting changes replyCount on every list showing the post.
      if (refreshPosts)
        await qc.invalidateQueries({
          predicate: (q) => {
            const k = String(q.queryKey[0] ?? '')
            return (
              k === getListPostsQueryKey()[0] ||
              /^\/users\/[^/]+\/(posts|likes)$/.test(k) ||
              k === '/auth/me/favorites'
            )
          },
        })
    } catch (err) {
      toast.error(serverError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex gap-2.5 text-sm">
      <CatAvatar avatar={r.authorAvatar} size="sm" />
      <div
        className={`min-w-0 flex-1 rounded-xl px-3 py-2 ring-1 ${
          r.pinned ? 'bg-brand-50/70 ring-brand-200' : 'bg-white ring-stone-100'
        }`}
      >
        <div className="mb-0.5 flex items-start gap-2">
          <div className="min-w-0 flex-1 text-xs text-stone-500">
            {r.pinned && (
              <span className="mr-1.5 inline-flex items-center gap-0.5 rounded-full bg-brand-100 px-1.5 py-0.5 font-medium text-brand-700">
                <Pin className="size-3" aria-hidden />
                {t('reply.pinned')}
              </span>
            )}
            <Link
              to="/users/$userId"
              params={{ userId: r.authorId }}
              className="font-medium text-stone-700 hover:text-brand-700"
            >
              {r.author}
            </Link>{' '}
            · <TimeAgo iso={r.createdAt} />
          </div>
          {(isPostAuthor || canReport) && (
            <div className="-mt-1 -mr-1.5 flex shrink-0 items-center">
              {isPostAuthor && (
                <>
                  <button
                    type="button"
                    className={iconButton}
                    disabled={busy}
                    aria-label={t(r.pinned ? 'reply.unpin' : 'reply.pin')}
                    title={t(r.pinned ? 'reply.unpin' : 'reply.pin')}
                    onClick={() => run(() => (r.pinned ? unpinReply : pinReply)(post.id, r.id))}
                  >
                    {r.pinned ? (
                      <PinOff className="size-3.5" aria-hidden />
                    ) : (
                      <Pin className="size-3.5" aria-hidden />
                    )}
                  </button>
                  <button
                    type="button"
                    className={`${iconButton} hover:bg-red-50 hover:text-red-600`}
                    disabled={busy}
                    aria-label={t('reply.delete')}
                    title={t('reply.delete')}
                    onClick={() => {
                      if (!window.confirm(t('reply.deleteConfirm'))) return
                      void run(() => deleteReply(post.id, r.id), 'reply.deleted', true)
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </>
              )}
              {canReport && (
                <button
                  type="button"
                  className={iconButton}
                  aria-label={t('reply.report')}
                  title={t('reply.report')}
                  aria-expanded={reporting}
                  onClick={() => setReporting((v) => !v)}
                >
                  <Flag className="size-3.5" aria-hidden />
                </button>
              )}
            </div>
          )}
        </div>
        <p className="whitespace-pre-wrap break-words">{r.content}</p>
        <ImageGrid urls={r.images} compact />
        {reporting && (
          <ReportForm
            busy={busy}
            onCancel={() => setReporting(false)}
            onSubmit={(reason, note) =>
              run(async () => {
                await reportReply(post.id, r.id, { reason, note: note || undefined })
                setReporting(false)
              }, 'reply.reported')
            }
          />
        )}
      </div>
    </li>
  )
}

function ReportForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean
  onCancel: () => void
  onSubmit: (reason: ReportReason, note: string) => void
}) {
  const { t } = useI18n()
  const id = useId()
  const [reason, setReason] = useState<ReportReason>('spam')
  const [note, setNote] = useState('')
  const tooLong = charCount(note.trim()) > REPORT_NOTE_MAX

  return (
    <form
      aria-label={t('reply.reportTitle')}
      className="mt-2 space-y-2.5 rounded-lg bg-stone-50 p-3 ring-1 ring-stone-100"
      onSubmit={(e) => {
        e.preventDefault()
        if (!tooLong) onSubmit(reason, note.trim())
      }}
    >
      <fieldset>
        <legend className="mb-1.5 font-medium text-stone-700">{t('reply.reportTitle')}</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {REASONS.map((r) => (
            <label key={r} className="flex cursor-pointer items-center gap-1.5 text-stone-700">
              <input
                type="radio"
                name={`${id}-reason`}
                value={r}
                checked={reason === r}
                onChange={() => setReason(r)}
                className="accent-brand-500"
              />
              {t(`reply.reason.${r}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor={`${id}-note`} className="sr-only">
          {t('reply.reportNote')}
        </label>
        <textarea
          id={`${id}-note`}
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('reply.reportNote')}
          aria-invalid={tooLong}
          className={`${inputClass} resize-none py-2 text-sm`}
        />
        <p className={`text-right text-xs ${tooLong ? 'text-red-600' : 'text-stone-400'}`}>
          {charCount(note.trim())}/{REPORT_NOTE_MAX}
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className={`${buttonClass.secondary} px-3 py-1.5 text-sm`}
          onClick={onCancel}
        >
          {t('reply.cancel')}
        </button>
        <button
          type="submit"
          className={`${buttonClass.primary} px-3 py-1.5 text-sm`}
          disabled={busy || tooLong}
        >
          {t('reply.reportSubmit')}
        </button>
      </div>
    </form>
  )
}
