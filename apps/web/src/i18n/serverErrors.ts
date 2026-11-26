import { errorMessage } from '../api/http'
import { useI18n } from './I18nProvider'
import type { MessageKey } from './messages'

// The API returns stable English messages; map the ones users can hit to
// translated text. Anything unknown is shown as-is.
const known: [test: (msg: string) => boolean, key: MessageKey][] = [
  [(m) => m.startsWith('incorrect email or password'), 'err.badCredentials'],
  [(m) => m.startsWith('too many failed attempts'), 'err.tooManyAttempts'],
  [(m) => m.includes('already registered'), 'err.emailTaken'],
  [(m) => m.startsWith('please sign in'), 'err.sessionExpired'],
  [(m) => m.startsWith('current password is incorrect'), 'err.currentPasswordWrong'],
  [(m) => m.startsWith('new password must differ'), 'err.newPasswordSame'],
  [(m) => m.includes('maximum number of replies'), 'replies.threadFull'],
  [(m) => m.includes('JPEG, PNG and WebP'), 'err.imageType'],
  [(m) => m.includes('5 MB') || m.includes('(413)'), 'err.imageSize'],
  [(m) => m.includes('dimensions'), 'err.imageDimensions'],
  [(m) => m.includes('could not read image'), 'err.imageCorrupt'],
]

export function serverErrorKey(err: unknown): MessageKey | undefined {
  const msg = errorMessage(err)
  return known.find(([test]) => test(msg))?.[1]
}

export function useServerError() {
  const { t } = useI18n()
  return (err: unknown) => {
    const key = serverErrorKey(err)
    return key ? t(key) : errorMessage(err)
  }
}
