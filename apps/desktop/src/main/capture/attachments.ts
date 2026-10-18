import { fitWithin, type Attachment } from '@hoot/core'
import type { Persistence } from '../store/persistence'
import type { Store } from '../store/store'
import type { CaptureImage } from './image'

/** Long edge sent to the model (Claude scales larger images down anyway). */
export const MAX_LONG_EDGE = 1568
const THUMB_EDGE = 160

export interface AttachmentDeps {
  store: Store
  persistence: Pick<Persistence, 'saveAttachment'>
  newId(): string
  now(): number
}

/**
 * Captures and clipboard images: fit to MAX_LONG_EDGE, save the PNG, make a
 * 160 px thumbnail, then list it in `chat.pendingAttachments` for the next send.
 */
export async function addImageAttachment(
  deps: AttachmentDeps,
  image: CaptureImage,
  kind: Attachment['kind']
): Promise<Attachment> {
  const fit = fitWithin(image.width, image.height, MAX_LONG_EDGE)
  const sized =
    fit.width === image.width && fit.height === image.height
      ? image
      : image.resize(fit.width, fit.height)
  const id = deps.newId()
  await deps.persistence.saveAttachment(id, sized.toPng())
  const thumb = fitWithin(fit.width, fit.height, THUMB_EDGE)
  const attachment: Attachment = {
    id,
    kind,
    thumbDataUrl: sized.resize(Math.max(1, thumb.width), Math.max(1, thumb.height)).toPngDataUrl(),
    width: fit.width,
    height: fit.height,
    createdAt: deps.now()
  }
  const chat = deps.store.get('chat')
  deps.store.update('chat', { pendingAttachments: [...chat.pendingAttachments, attachment] })
  return attachment
}
