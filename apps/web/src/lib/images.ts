import imageCompression from 'browser-image-compression'
import type { MessageKey } from '../i18n/messages'
import { IMAGE_MAX_BYTES, IMAGE_MAX_EDGE_PX, IMAGE_TARGET_MB, IMAGE_TYPES } from './limits'

export type ImageCheck = { ok: true } | { ok: false; reason: MessageKey }

export function checkImage(file: File): ImageCheck {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, reason: 'err.imageType' }
  }
  if (file.size > IMAGE_MAX_BYTES) {
    return { ok: false, reason: 'err.imageSize' }
  }
  return { ok: true }
}

/** Resize + recompress before upload. Server re-processes and strips EXIF. */
export function compressImage(file: File): Promise<File> {
  return imageCompression(file, {
    maxSizeMB: IMAGE_TARGET_MB,
    maxWidthOrHeight: IMAGE_MAX_EDGE_PX,
    useWebWorker: true,
  })
}
