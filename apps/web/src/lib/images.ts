import imageCompression from 'browser-image-compression'
import { IMAGE_MAX_BYTES, IMAGE_MAX_EDGE_PX, IMAGE_TARGET_MB, IMAGE_TYPES } from './limits'

export type ImageCheck = { ok: true } | { ok: false; reason: string }

export function checkImage(file: File): ImageCheck {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, reason: '只支持 JPG、PNG、WebP 格式' }
  }
  if (file.size > IMAGE_MAX_BYTES) {
    return { ok: false, reason: '单张图片不能超过 5MB' }
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
