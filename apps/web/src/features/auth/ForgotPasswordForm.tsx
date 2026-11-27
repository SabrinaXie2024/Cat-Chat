import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { useCompletePasswordReset, useStartPasswordReset } from '../../api/generated/auth/auth'
import type { User, VerificationSent } from '../../api/generated/model'
import { useFieldError, useI18n } from '../../i18n/I18nProvider'
import { useServerError } from '../../i18n/serverErrors'
import { PASSWORD_MAX_CHARS, PASSWORD_MIN_CHARS } from '../../lib/limits'
import { Field, inputClass, submitClass } from './AuthCard'
import { digits6, errorField, mmss, useNow } from './codeHelpers'
import { meQueryKey } from './useCurrentUser'

type Sent = { email: string; expiresAt: number; resendAt: number }

/**
 * Forgot password: email → code + new password. The server answers the same
 * for unknown emails, so the UI never says whether an account exists.
 */
export function ForgotPasswordForm({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useI18n()
  const serverError = useServerError()
  const start = useStartPasswordReset()
  const [sent, setSent] = useState<Sent | null>(null)
  const [lastEmail, setLastEmail] = useState('')

  const sendErrorText = (err: unknown) => {
    const wait = errorField(err, 'retryAfterSeconds')
    return wait ? t('err.sendTooSoon', { seconds: wait }) : serverError(err)
  }

  async function send(email: string) {
    const res = await start.mutateAsync({ data: { email } })
    const { expiresInSeconds, resendAfterSeconds } = res.data as VerificationSent
    const now = Date.now()
    setSent({
      email,
      expiresAt: now + expiresInSeconds * 1000,
      resendAt: now + resendAfterSeconds * 1000,
    })
  }

  if (!sent) {
    return (
      <EmailStep
        initial={lastEmail}
        sending={start.isPending}
        error={start.error ? sendErrorText(start.error) : null}
        onSubmit={(email) => send(email).catch(() => {})}
      />
    )
  }
  return (
    <ResetStep
      sent={sent}
      onResend={async () => {
        try {
          await send(sent.email)
          toast.success(t('verify.resent'))
        } catch (err) {
          toast.error(sendErrorText(err))
        }
      }}
      onBack={() => {
        setLastEmail(sent.email)
        setSent(null)
      }}
      onSuccess={onSuccess}
    />
  )
}

const emailSchema = z.object({ email: z.email('err.emailInvalid') })

function EmailStep({
  initial,
  sending,
  error,
  onSubmit,
}: {
  initial: string
  sending: boolean
  error: string | null
  onSubmit: (email: string) => void
}) {
  const { t } = useI18n()
  const fieldError = useFieldError()
  const form = useForm<z.infer<typeof emailSchema>>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: initial },
  })
  return (
    <form
      onSubmit={form.handleSubmit(({ email }) => onSubmit(email.trim()))}
      className="space-y-4"
      noValidate
    >
      <p className="text-sm text-stone-600">{t('reset.intro')}</p>
      <Field
        id="email"
        label={t('auth.email')}
        error={fieldError(form.formState.errors.email?.message)}
      >
        <input
          id="email"
          type="email"
          autoComplete="username"
          className={inputClass}
          {...form.register('email')}
        />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button type="submit" disabled={sending} className={submitClass}>
        {t('auth.sendCode')}
      </button>
    </form>
  )
}

// Must match apps/api. Messages are i18n keys.
const resetSchema = z
  .object({
    code: z.string().regex(/^\d{6}$/, 'err.codeFormat'),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_CHARS, 'err.newPasswordTooShort')
      .max(PASSWORD_MAX_CHARS, 'err.newPasswordTooLong'),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, {
    path: ['confirm'],
    message: 'err.newPasswordMismatch',
  })
type ResetValues = z.infer<typeof resetSchema>

function ResetStep({
  sent,
  onResend,
  onBack,
  onSuccess,
}: {
  sent: Sent
  onResend: () => Promise<void>
  onBack: () => void
  onSuccess: () => void
}) {
  const { t } = useI18n()
  const fieldError = useFieldError()
  const serverError = useServerError()
  const qc = useQueryClient()
  const now = useNow()
  const [resending, setResending] = useState(false)
  const codeRef = useRef<HTMLInputElement | null>(null)
  const form = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    defaultValues: { code: '', newPassword: '', confirm: '' },
  })
  const complete = useCompletePasswordReset({
    mutation: {
      onSuccess: (res) => {
        qc.setQueryData(meQueryKey, res.data as User)
        toast.success(t('reset.done'))
        onSuccess()
      },
    },
  })

  // A fresh code (resend) clears the code box and the last error.
  // biome-ignore lint/correctness/useExhaustiveDependencies: sent identity is the trigger
  useEffect(() => {
    form.setValue('code', '')
    complete.reset()
    codeRef.current?.focus()
  }, [sent])

  const expired = now >= sent.expiresAt
  const resendWait = Math.ceil((sent.resendAt - now) / 1000)
  const left = errorField(complete.error, 'attemptsLeft')
  const serverText = !complete.error
    ? null
    : left === undefined || left < 0
      ? serverError(complete.error)
      : left > 0
        ? t('err.codeWrong', { attemptsLeft: left })
        : t('err.codeExpired')
  const error = expired ? t('err.codeExpired') : serverText
  const { errors } = form.formState
  const codeField = form.register('code')

  return (
    <form
      onSubmit={form.handleSubmit(({ code, newPassword }) =>
        complete.mutate({ data: { email: sent.email, code, newPassword } }),
      )}
      className="space-y-4"
      noValidate
    >
      <div className="space-y-1">
        <p className="text-sm text-stone-600">{t('reset.sentTo', { email: sent.email })}</p>
        <p className="text-xs text-stone-400">{t('verify.checkSpam')}</p>
      </div>
      {/* Lets password managers file the new password under this account. */}
      <input
        type="text"
        name="username"
        autoComplete="username"
        value={sent.email}
        readOnly
        hidden
      />
      <Field id="code" label={t('verify.code')} error={fieldError(errors.code?.message)}>
        <input
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className={`${inputClass} text-center text-2xl tracking-[0.5em]`}
          {...codeField}
          ref={(el) => {
            codeField.ref(el)
            codeRef.current = el
          }}
          onChange={(e) => {
            e.target.value = digits6(e.target.value)
            void codeField.onChange(e)
          }}
        />
      </Field>
      <p className="text-xs text-stone-500" aria-live="polite">
        {expired ? null : t('verify.expiresIn', { time: mmss(sent.expiresAt - now) })}
      </p>
      <Field
        id="newPassword"
        label={t('settings.newPassword')}
        error={fieldError(errors.newPassword?.message)}
      >
        <input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          className={inputClass}
          {...form.register('newPassword')}
        />
      </Field>
      <Field
        id="confirm"
        label={t('settings.confirmNew')}
        error={fieldError(errors.confirm?.message)}
      >
        <input
          id="confirm"
          type="password"
          autoComplete="new-password"
          className={inputClass}
          {...form.register('confirm')}
        />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button type="submit" disabled={complete.isPending || expired} className={submitClass}>
        {t('reset.submit')}
      </button>
      <div className="flex justify-between text-sm">
        <button type="button" onClick={onBack} className="text-stone-500 hover:text-stone-800">
          {t('reset.changeEmail')}
        </button>
        <button
          type="button"
          disabled={resendWait > 0 || resending}
          onClick={async () => {
            setResending(true)
            await onResend()
            setResending(false)
          }}
          className="text-brand-700 hover:underline disabled:text-stone-400 disabled:no-underline"
        >
          {resendWait > 0 ? t('verify.resendIn', { seconds: resendWait }) : t('verify.resend')}
        </button>
      </div>
    </form>
  )
}
