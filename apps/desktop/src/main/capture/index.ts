/** Screen capture in the main process (owner: d2, docs/finish-plan.md §2). The rest of main imports only from here. */
export {
  MAX_PENDING,
  createCaptureService,
  type CaptureDeps,
  type CaptureService,
  type CaptureSurfaces,
  type ShapeApp
} from './service'
export { createCaptureHandlers, type CaptureChannel, type CaptureHandlers } from './ipc'
export { addImageAttachment, type AttachmentDeps } from './attachments'
export { fromNativeImage, type CaptureImage } from './image'
