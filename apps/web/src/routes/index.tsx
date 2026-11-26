import { createFileRoute, Link } from '@tanstack/react-router'
import { useI18n } from '../i18n/I18nProvider'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const { t } = useI18n()
  return (
    <section className="space-y-4">
      <h1 className="text-3xl font-bold">{t('home.welcome')}</h1>
      <p className="text-stone-600">{t('home.tagline')}</p>
      <Link
        to="/community"
        className="inline-block rounded-lg bg-brand-500 px-4 py-2 font-medium text-white hover:bg-brand-700"
      >
        {t('home.cta')}
      </Link>
    </section>
  )
}
