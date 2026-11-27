import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { HTTPError } from 'ky'
import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { useStartRegistration, useVerifyRegistration } from '../../api/generated/auth/auth'
import type { RegisterRequest, User, VerificationSent } from '../../api/generated/model'
import { useFieldError, useI18n } from '../../i18n/I18nProvider'
import { useServerError } from '../../i18n/serverErrors'
import {
  charCount,
  NICKNAME_MAX_CHARS,
  PASSWORD_MAX_CHARS,
  PASSWORD_MIN_CHARS,
} from '../../lib/limits'
import { Field, inputClass, submitClass } from './AuthCard'
import { meQueryKey } from './useCurrentUser'

// Must match apps/api/internal/api. Messages are i18n keys.
const detailsSchema = z
  .object({
    email: z.email('err.emailInvalid'),
    nickname: z
      .string()
      .refine((s) => charCount(s) >= 1, 'err.nicknameRequired')
      .refine((s) => charCount(s) <= NICKNAME_MAX_CHARS, 'err.nicknameTooLong'),
    password: z
      .string()
      .min(PASSWORD_MIN_CHARS, 'err.passwordTooShort')
      .max(PASSWORD_MAX_CHARS, 'err.passwordTooLong'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'err.passwordMismatch' })
type Details = z.infer<typeof detailsSchema>

/** Error body fields beyond `message` (429 retryAfterSeconds, 400 attemptsLeft). */
function errorField(err: unknown, field: 'retryAfterSeconds' | 'attemptsLeft'): number | undefined {
  if (!(err instanceof HTTPError)) return undefined
  const v = (err.data as Record<string, unknown> | undefined)?.[field]
  return typeof v === 'number' ? v : undefined
}

type Pending = { request: RegisterRequest; expiresAt: number; resendAt: number }

/**
 * Sign-up in two steps: details → emailed 6-digit code (valid 5 minutes).
 * The account only exists after the code is verified.
 */
export function RegisterForm({ onSuccess }: { onSuccess: () => void }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [lastRequest, setLastRequest] = useState<RegisterRequest | undefined>()
  const { t } = useI18n()
  const serverError = useServerError()
  const start = useStartRegistration()

  const sendErrorText = (err: unknown) => {
    const wait = errorField(err, 'retryAfterSeconds')
    return wait ? t('err.sendTooSoon', { seconds: wait }) : serverError(err)
  }

  async function send(request: RegisterRequest) {
    const res = await start.mutateAsync({ data: request })
    const { expiresInSeconds, resendAfterSeconds } = res.data as VerificationSent
    const now = Date.now()
    setPending({
      request,
      expiresAt: now + expiresInSeconds * 1000,
      resendAt: now + resendAfterSeconds * 1000,
    })
  }

  return pending ? (
    <CodeStep
      pending={pending}
      onResend={async () => {
        try {
          await send(pending.request)
          toast.success(t('verify.resent'))
        } catch (err) {
          toast.error(sendErrorText(err))
        }
      }}
      onBack={() => {
        setLastRequest(pending.request) // keep what they typed
        setPending(null)
      }}
      onSuccess={onSuccess}
    />
  ) : (
    <DetailsStep
      initial={lastRequest}
      sending={start.isPending}
      error={start.error ? sendErrorText(start.error) : null}
      onSubmit={(request) => send(request).catch(() => {})}
    />
  )
}

function DetailsStep({
  initial,
  sending,
  error,
  onSubmit,
}: {
  initial: RegisterRequest | undefined
  sending: boolean
  error: string | null
  onSubmit: (r: RegisterRequest) => void
}) {
  const { t } = useI18n()
  const fieldError = useFieldError()
  const form = useForm<Details>({
    resolver: zodResolver(detailsSchema),
    defaultValues: {
      email: initial?.email ?? '',
      nickname: initial?.nickname ?? '',
      password: initial?.password ?? '',
      confirm: initial?.password ?? '',
    },
  })
  const { errors } = form.formState

  return (
    <form
      onSubmit={form.handleSubmit(({ email, nickname, password }) =>
        onSubmit({ email: email.trim(), nickname: nickname.trim(), password }),
      )}
      className="space-y-4"
      noValidate
    >
      {/* Nickname first: password managers treat the field right before the
          password as the username when hints are missing. The email is the
          login identifier, so it must be `autocomplete="username"` and sit
          directly above the password. */}
      <Field id="nickname" label={t('auth.nickname')} error={fieldError(errors.nickname?.message)}>
        <input
          id="nickname"
          autoComplete="nickname"
          className={inputClass}
          {...form.register('nickname')}
        />
      </Field>
      <Field id="email" label={t('auth.email')} error={fieldError(errors.email?.message)}>
        <input
          id="email"
          type="email"
          autoComplete="username"
          className={inputClass}
          {...form.register('email')}
        />
      </Field>
      <Field
        id="password"
        label={t('auth.passwordNew')}
        error={fieldError(errors.password?.message)}
      >
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          className={inputClass}
          {...form.register('password')}
        />
      </Field>
      <Field id="confirm" label={t('auth.confirm')} error={fieldError(errors.confirm?.message)}>
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
      <button type="submit" disabled={sending} className={submitClass}>
        {t('auth.sendCode')}
      </button>
    </form>
  )
}

/** Ticks once a second so countdowns re-render. */
function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function CodeStep({
  pending,
  onResend,
  onBack,
  onSuccess,
}: {
  pending: Pending
  onResend: () => Promise<void>
  onBack: () => void
  onSuccess: () => void
}) {
  const { t } = useI18n()
  const serverError = useServerError()
  const qc = useQueryClient()
  const now = useNow()
  const [code, setCode] = useState('')
  const [formatError, setFormatError] = useState(false)
  const [resending, setResending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const verify = useVerifyRegistration({
    mutation: {
      onSuccess: (res) => {
        qc.setQueryData(meQueryKey, res.data as User)
        onSuccess()
      },
    },
  })

  // A fresh code (resend) clears the old attempt.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pending identity is the trigger
  useEffect(() => {
    setCode('')
    verify.reset()
    inputRef.current?.focus()
  }, [pending])

  const expired = now >= pending.expiresAt
  const resendWait = Math.ceil((pending.resendAt - now) / 1000)
  const left = errorField(verify.error, 'attemptsLeft')
  const error = formatError
    ? t('err.codeFormat')
    : expired
      ? t('err.codeExpired')
      : verify.error
        ? left !== undefined
          ? left > 0
            ? t('err.codeWrong', { attemptsLeft: left })
            : t('err.codeExpired')
          : serverError(verify.error)
        : null

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!/^\d{6}$/.test(code)) return setFormatError(true)
        verify.mutate({ data: { email: pending.request.email, code } })
      }}
      className="space-y-4"
      noValidate
    >
      <div className="space-y-1">
        <h2 className="font-semibold">{t('verify.title')}</h2>
        <p className="text-sm text-stone-600">
          {t('verify.sentTo', { email: pending.request.email })}
        </p>
        <p className="text-xs text-stone-400">{t('verify.checkSpam')}</p>
      </div>
      <Field id="code" label={t('verify.code')}>
        <input
          ref={inputRef}
          id="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => {
            setFormatError(false)
            setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
          }}
          className={`${inputClass} text-center text-2xl tracking-[0.5em]`}
        />
      </Field>
      <p className="text-xs text-stone-500" aria-live="polite">
        {expired ? null : t('verify.expiresIn', { time: mmss(pending.expiresAt - now) })}
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button type="submit" disabled={verify.isPending || expired} className={submitClass}>
        {t('verify.submit')}
      </button>
      <div className="flex justify-between text-sm">
        <button type="button" onClick={onBack} className="text-stone-500 hover:text-stone-800">
          {t('verify.changeEmail')}
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
