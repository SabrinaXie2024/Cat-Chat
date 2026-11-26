import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { useChangePassword } from '../../api/generated/auth/auth'
import { useFieldError, useI18n } from '../../i18n/I18nProvider'
import { useServerError } from '../../i18n/serverErrors'
import { PASSWORD_MAX_CHARS, PASSWORD_MIN_CHARS } from '../../lib/limits'
import { Field, inputClass, submitClass } from './AuthCard'

// Must match apps/api/internal/api/auth.go. Messages are i18n keys.
const schema = z
  .object({
    currentPassword: z.string().min(1, 'err.currentPasswordRequired'),
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
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ['newPassword'],
    message: 'err.newPasswordSame',
  })
type Values = z.infer<typeof schema>

export function ChangePasswordForm({ email }: { email: string }) {
  const { t } = useI18n()
  const fieldError = useFieldError()
  const serverError = useServerError()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
  })
  const change = useChangePassword({
    mutation: {
      onSuccess: () => {
        form.reset()
        toast.success(t('settings.changed'))
      },
    },
  })
  const { errors } = form.formState

  return (
    <form
      onSubmit={form.handleSubmit(({ currentPassword, newPassword }) =>
        change.mutate({ data: { currentPassword, newPassword } }),
      )}
      className="space-y-4"
      noValidate
    >
      {/* Lets password managers attach the new password to the right
          account instead of guessing. */}
      <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
      <Field
        id="currentPassword"
        label={t('settings.currentPassword')}
        error={fieldError(errors.currentPassword?.message)}
      >
        <input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          className={inputClass}
          {...form.register('currentPassword')}
        />
      </Field>
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
      {change.error && (
        <p role="alert" className="text-sm text-red-600">
          {serverError(change.error)}
        </p>
      )}
      <button type="submit" disabled={change.isPending} className={submitClass}>
        {t('settings.changePassword')}
      </button>
    </form>
  )
}
