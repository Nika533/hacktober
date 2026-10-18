/**
 * @hoot/bridge: the extension ⇄ app link (owner: C).
 * - `createBridgeConnection`: protocol logic for one connection, used by the
 *   app's pipe server and dev WebSocket (C-20) and by the fake server.
 * - `planRegistration` / `applyRegistration`: registering hoot-bridge with
 *   Chrome, Edge, Chromium and Brave (the CLI is `src/registerCli.ts`).
 */
export * from './connection'
export { runHost, type HostIO } from './host/relay'
export {
  applyRegistration,
  isRegistered,
  nativeHostManifest,
  nodeRegistrationIO,
  planRegistration,
  type NativeHostManifest,
  type RegistrationIO,
  type RegistrationPlan
} from './register'
