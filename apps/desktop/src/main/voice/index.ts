/** The voice chat: Windows speech in and out, driving the active chat. */
export { unavailableEngine, type SpeechEngine, type SpeechEvent } from './engine'
export { FAKE_PHRASES, createFakeSpeechEngine, type FakeSpeechOptions } from './fake'
export { createWindowsSpeechEngine } from './windows'
export {
  MIN_CONFIDENCE,
  NOISE_PEAK,
  VOICE_TIMING,
  createVoiceService,
  type VoiceService,
  type VoiceServiceDeps
} from './service'
export { createVoiceHandlers } from './ipc'
