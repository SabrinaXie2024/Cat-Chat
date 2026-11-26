import { createFileRoute } from '@tanstack/react-router'
import { useI18n } from '../i18n/I18nProvider'

export const Route = createFileRoute('/gallery')({ component: Gallery })

function Gallery() {
  const { t } = useI18n()
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-bold">{t('gallery.title')}</h1>
      <p className="text-stone-600">{t('gallery.soon')}</p>
    </section>
  )
}
