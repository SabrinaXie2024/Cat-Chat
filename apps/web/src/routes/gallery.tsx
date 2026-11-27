import { createFileRoute } from '@tanstack/react-router'
import { Images } from 'lucide-react'
import { PageHero } from '../components/ui'
import { useCurrentUser } from '../features/auth/useCurrentUser'
import { GalleryGrid } from '../features/gallery/GalleryGrid'
import { GalleryUploader } from '../features/gallery/GalleryUploader'
import { useI18n } from '../i18n/I18nProvider'

export const Route = createFileRoute('/gallery')({ component: Gallery })

function Gallery() {
  const { t } = useI18n()
  const { data: user } = useCurrentUser()
  const isAdmin = user?.isAdmin === true
  return (
    <section className="space-y-6">
      <PageHero icon={Images} title={t('gallery.title')} subtitle={t('gallery.subtitle')} />
      {isAdmin && <GalleryUploader />}
      <GalleryGrid canManage={isAdmin} />
    </section>
  )
}
