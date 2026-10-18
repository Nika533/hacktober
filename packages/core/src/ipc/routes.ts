import type { HootApi } from './api'

export type Route =
  | { readonly kind: 'invoke'; readonly channel: string }
  | { readonly kind: 'send'; readonly channel: string }
  | { readonly kind: 'event'; readonly channel: string }

const invoke = <C extends string>(channel: C) => ({ kind: 'invoke', channel }) as const
const send = <C extends string>(channel: C) => ({ kind: 'send', channel }) as const
const event = <C extends string>(channel: C) => ({ kind: 'event', channel }) as const

/** Every HootApi method and the IPC channel behind it. */
export const HOOT_API_ROUTES = {
  state: { subscribe: invoke('state:subscribe'), onPatch: event('state:patch') },
  chat: {
    send: invoke('chat:send'),
    stop: invoke('chat:stop'),
    regenerate: invoke('chat:regenerate'),
    newChat: invoke('chat:new'),
    onDelta: event('chat:delta')
  },
  sessions: {
    open: invoke('sessions:open'),
    rename: invoke('sessions:rename'),
    delete: invoke('sessions:delete'),
    undoDelete: invoke('sessions:undoDelete'),
    clearAll: invoke('sessions:clearAll'),
    search: invoke('sessions:search')
  },
  attachments: { open: invoke('attachments:open'), remove: invoke('attachments:remove') },
  clipboard: {
    writeText: invoke('clipboard:writeText'),
    arm: invoke('clipboard:arm'),
    dismiss: invoke('clipboard:dismiss')
  },
  buddy: {
    requestMode: send('buddy:requestMode'),
    transitionDone: send('buddy:transitionDone'),
    setIgnoreMouse: send('buddy:setIgnoreMouse'),
    setHitRegions: send('buddy:hitRegions'),
    dragStart: send('buddy:dragStart'),
    dragMove: send('buddy:dragMove'),
    dragEnd: send('buddy:dragEnd'),
    setCursorTracking: send('buddy:setCursorTracking'),
    dismissGreeting: invoke('buddy:dismissGreeting'),
    onTransition: event('buddy:transition'),
    onCursor: event('buddy:cursor')
  },
  capture: {
    start: invoke('capture:start'),
    getInit: invoke('capture:getInit'),
    commit: invoke('capture:commit'),
    cancel: invoke('capture:cancel'),
    click: invoke('capture:click'),
    minimize: invoke('capture:minimize'),
    onOpen: event('capture:open'),
    onClosed: event('capture:closed'),
    onUserClick: event('capture:userClick'),
    onRestore: event('capture:restore')
  },
  pins: {
    create: invoke('pins:create'),
    createFromText: invoke('pins:createFromText'),
    resize: send('pins:resize'),
    close: invoke('pins:close'),
    openInHoot: invoke('pins:openInHoot')
  },
  settings: {
    update: invoke('settings:update'),
    setApiKey: invoke('settings:setApiKey'),
    validateApiKey: invoke('settings:validateApiKey'),
    clearApiKey: invoke('settings:clearApiKey'),
    resetAnchor: invoke('settings:resetAnchor'),
    suspendHotkeys: invoke('settings:suspendHotkeys')
  },
  windows: {
    openStudio: invoke('windows:openStudio'),
    lockStudio: invoke('windows:lockStudio'),
    openReader: invoke('windows:openReader')
  },
  onboarding: { setStep: invoke('onboarding:setStep'), finish: invoke('onboarding:finish') },
  reader: {
    pickFile: invoke('reader:pickFile'),
    current: invoke('reader:current'),
    onDocument: event('reader:document')
  },
  lens: {
    assess: invoke('lens:assess'),
    rewrite: invoke('lens:rewrite'),
    cancel: invoke('lens:cancel'),
    feedback: invoke('lens:feedback'),
    explain: invoke('lens:explain'),
    profile: invoke('lens:profile'),
    snapshot: invoke('lens:snapshot'),
    patchProfile: invoke('lens:patchProfile'),
    resetProfile: invoke('lens:resetProfile'),
    exportProfile: invoke('lens:exportProfile'),
    recentChanges: invoke('lens:recentChanges'),
    glossary: invoke('lens:glossary'),
    onProfile: event('lens:profileChanged')
  },
  anywhere: {
    current: invoke('anywhere:current'),
    onUpdate: event('anywhere:update'),
    resize: send('anywhere:resize'),
    act: invoke('anywhere:act'),
    close: invoke('anywhere:close')
  },
  code: {
    apply: invoke('code:apply'),
    reveal: invoke('code:reveal'),
    tagStates: invoke('code:tagStates'),
    onChange: event('code:changed')
  },
  voice: {
    start: invoke('voice:start'),
    finish: invoke('voice:finish'),
    stop: invoke('voice:stop'),
    speak: invoke('voice:speak')
  },
  app: { openExternal: invoke('app:openExternal') }
} as const satisfies { [N in keyof HootApi]: { [M in keyof HootApi[N]]-?: Route } }

type Routes = typeof HOOT_API_ROUTES
type AnyRoute = { [N in keyof Routes]: Routes[N][keyof Routes[N]] }[keyof Routes]

export type InvokeChannel = Extract<AnyRoute, { kind: 'invoke' }>['channel']
export type SendChannel = Extract<AnyRoute, { kind: 'send' }>['channel']
export type EventChannel = Extract<AnyRoute, { kind: 'event' }>['channel']

type Entry = {
  [N in keyof Routes]: {
    [M in keyof Routes[N] & keyof HootApi[N]]: { route: Routes[N][M]; fn: HootApi[N][M] }
  }[keyof Routes[N] & keyof HootApi[N]]
}[keyof Routes]

/** The HootApi method behind a channel, e.g. `ApiFn<'chat:send'>`. */
export type ApiFn<C extends string> = Extract<Entry, { route: { channel: C } }>['fn']

/** What a main-process handler for an invoke channel must resolve with. */
export type InvokeResult<C extends InvokeChannel> =
  ApiFn<C> extends (...args: never[]) => infer R ? Awaited<R> : never

/** Payload main sends on an event channel. */
export type EventPayload<C extends EventChannel> =
  ApiFn<C> extends (cb: infer CB) => unknown
    ? CB extends (...args: infer A) => unknown
      ? A extends [infer P, ...unknown[]]
        ? P
        : undefined
      : never
    : never

export interface IpcTransport {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  send(channel: string, ...args: unknown[]): void
  /** Returns a function that removes the listener. */
  on(channel: string, listener: (payload: unknown) => void): () => void
}

/** Build `window.hoot` from the route table (used by preload). */
export function createHootApi(transport: IpcTransport): HootApi {
  const api: Record<string, Record<string, unknown>> = {}
  for (const [group, methods] of Object.entries(HOOT_API_ROUTES)) {
    const out: Record<string, unknown> = {}
    for (const [name, route] of Object.entries(methods as Record<string, Route>)) {
      out[name] =
        route.kind === 'invoke'
          ? (...args: unknown[]) => transport.invoke(route.channel, ...args)
          : route.kind === 'send'
            ? (...args: unknown[]) => transport.send(route.channel, ...args)
            : (cb: (payload: unknown) => void) => transport.on(route.channel, cb)
    }
    api[group] = out
  }
  return api as unknown as HootApi
}
