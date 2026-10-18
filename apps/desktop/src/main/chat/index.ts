/** Chat and sessions in the main process (owner: C, docs/finish-plan.md §2). */
export { createChatService, type ChatActivity, type ChatDeps, type ChatService } from './service'
export { createChatHandlers, type ChatChannel, type ChatHandlers } from './ipc'
