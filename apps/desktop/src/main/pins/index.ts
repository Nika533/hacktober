/** Sticky-note pins in the main process (owner: C, docs/finish-plan.md §2). */
export { createPinsService, type NoteWindows, type PinsDeps, type PinsService } from './service'
export { createNoteWindows, NOTE_WIDTH, type NoteWindowsDeps } from './windows'
export { createPinsHandlers, type Sender } from './ipc'
