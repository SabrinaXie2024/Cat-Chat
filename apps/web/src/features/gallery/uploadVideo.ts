import type { Video } from '../../api/generated/model'

/**
 * Video upload with progress. Uses XHR because fetch upload progress needs
 * streaming request bodies, which Chromium only allows over HTTP/2+ (local
 * dev is HTTP/1.1). Rejects with an Error carrying the server's message so
 * `useServerError` can translate it.
 */
export function uploadVideo(file: Blob, onProgress: (fraction: number) => void): Promise<Video> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/videos')
    xhr.withCredentials = true
    xhr.responseType = 'text'
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      let body: unknown
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        body = undefined
      }
      if (xhr.status === 201) return resolve(body as Video)
      const msg = (body as { message?: string } | undefined)?.message
      reject(new Error(msg ?? `Request failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('Network error'))
    const form = new FormData()
    form.append('file', file)
    xhr.send(form)
  })
}
