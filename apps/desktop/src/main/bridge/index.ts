/** The extension bridge in the main process (owner: C). */
export {
  AnotherInstanceError,
  createBridgeServer,
  type BridgeServer,
  type BridgeServerDeps
} from './server'
export { ensureNativeHost, type NativeHostDeps, type NativeHostResult } from './nativeHost'
