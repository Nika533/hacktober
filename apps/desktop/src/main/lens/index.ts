/** Hoot Lens in the main process (owner: C). The rest of main imports only from here. */
export { createLensService, type LensService, type LensServiceDeps } from './service'
export { createLensHandlers, type LensChannel, type LensHandlers } from './ipc'
export { createFsLensStorage, createMemoryLensStorage, type LensStorage } from './storage'
