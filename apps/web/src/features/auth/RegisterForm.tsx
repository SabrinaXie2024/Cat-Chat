import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useRegister } from '../../api/generated/auth/auth'
import type { User } from '../../api/generated/model'
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

// Must match apps/api/internal/api/auth.go. Messages are i18n keys.
const schema = z
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
type Values = z.infer<typeof schema>

export function RegisterForm({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useI18n()
  const fieldError = useFieldError()
  const serverError = useServerError()
  const qc = useQueryClient()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', nickname: '', password: '', confirm: '' },
  })
  const register = useRegister({
    mutation: {
      onSuccess: (res) => {
        qc.setQueryData(meQueryKey, res.data as User)
        onSuccess()
      },
    },
  })
  const { errors } = form.formState

  return (
    <form
      onSubmit={form.handleSubmit(({ email, nickname, password }) =>
        register.mutate({ data: { email, nickname: nickname.trim(), password } }),
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
      {register.error && (
        <p role="alert" className="text-sm text-red-600">
          {serverError(register.error)}
        </p>
      )}
      <button type="submit" disabled={register.isPending} className={submitClass}>
        {t('auth.register')}
      </button>
    </form>
  )
}
