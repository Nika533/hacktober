/** Agents: extra chats in their own windows, each minimizing into an owl of its own colour. */
export { createAgentsService, type AgentsDeps, type AgentsService } from './service'
export { createAgentWindows, type AgentWindows, type AgentWindowsDeps } from './windows'
export { CARD, OWL, cardAt, fitInto, owlAt, placeCard } from './geometry'
export { createAgentsHandlers } from './ipc'
