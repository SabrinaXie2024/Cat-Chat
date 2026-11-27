import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useLogin } from '../../api/generated/auth/auth'
import type { User } from '../../api/generated/model'
import { useFieldError, useI18n } from '../../i18n/I18nProvider'
import { useServerError } from '../../i18n/serverErrors'
import { Field, inputClass, submitClass } from './AuthCard'
import { meQueryKey } from './useCurrentUser'

// Messages are i18n keys, translated at render.
const schema = z.object({
  email: z.email('err.emailInvalid'),
  password: z.string().min(1, 'err.passwordRequired'),
})
type Values = z.infer<typeof schema>

export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useI18n()
  const fieldError = useFieldError()
  const serverError = useServerError()
  const qc = useQueryClient()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  })
  const login = useLogin({
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
      onSubmit={form.handleSubmit((data) => login.mutate({ data }))}
      className="space-y-4"
      noValidate
    >
      <Field id="email" label={t('auth.email')} error={fieldError(errors.email?.message)}>
        <input
          id="email"
          type="email"
          autoComplete="username"
          className={inputClass}
          {...form.register('email')}
        />
      </Field>
      <Field id="password" label={t('auth.password')} error={fieldError(errors.password?.message)}>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          className={inputClass}
          {...form.register('password')}
        />
      </Field>
      <p className="-mt-2 text-right text-sm">
        <Link to="/forgot-password" className="text-brand-700 hover:underline">
          {t('auth.forgot')}
        </Link>
      </p>
      {login.error && (
        <p role="alert" className="text-sm text-red-600">
          {serverError(login.error)}
        </p>
      )}
      <button type="submit" disabled={login.isPending} className={submitClass}>
        {t('auth.login')}
      </button>
    </form>
  )
}
