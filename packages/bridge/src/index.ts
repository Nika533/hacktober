/**
 * @hoot/bridge: the extension ⇄ app link (owner: C).
 * - `createBridgeConnection`: protocol logic for one connection, used by the
 *   app's pipe server and dev WebSocket (C-20) and by the fake server.
 * - hoot-bridge, the native messaging host binary, arrives in C-21.
 */
export * from './connection'
