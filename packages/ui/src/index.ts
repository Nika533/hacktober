// Styles are a separate entry: import '@hoot/ui/styles.css' once per window.

export { cx } from './cx'
export {
  applyAccent,
  applyTheme,
  contrastRatio,
  onAccentFor,
  parseHexColor,
  relativeLuminance,
  toHex,
  type Rgb,
  type ThemePreference
} from './theme'
export { crossFade, springs } from './motion/springs'
export { useMediaQuery } from './hooks/useMediaQuery'
export { useReducedMotion } from 'motion/react'

export { Owl, type OwlProps } from './components/Owl'
export { OWL_MOODS, type OwlMood } from './components/owlMood'
export { Button, type ButtonProps, type ButtonVariant } from './components/Button'
export { IconButton, type IconButtonProps } from './components/IconButton'
export { Kbd, type KbdProps } from './components/Kbd'
export { Tooltip, type TooltipProps } from './components/Tooltip'
export { placeTooltip, type Placement, type Side } from './components/placeTooltip'
export { Segmented, type SegmentedOption, type SegmentedProps } from './components/Segmented'
export { Switch, type SwitchProps } from './components/Switch'
export { TextField, type TextFieldProps } from './components/TextField'
export { Slider, type SliderProps } from './components/Slider'
export { ToastProvider, TOAST_DEFAULT_MS } from './components/Toast'
export {
  useToast,
  type ToastApi,
  type ToastOptions,
  type ToastTone
} from './components/toastContext'
export { Dialog, type DialogProps } from './components/Dialog'
export { ConfirmProvider } from './components/ConfirmProvider'
export { useConfirm, type Confirm, type ConfirmOptions } from './components/confirmContext'
export { HootUIProvider } from './components/HootUIProvider'
export { Chip, type ChipProps } from './components/Chip'

// Shared chat UI (D3-10)
export type { ChatAttachmentView, ChatMessageView, QuickAction } from './chat/types'
export { describeChatError, toAiErrorCode, type ChatErrorCopy } from './chat/describeError'
export { clipboardChipLabel } from './chat/labels'
export { copyText, type CopyFn } from './chat/copyText'
export { isAtBottom } from './chat/scroll'
export { Markdown, type MarkdownProps } from './chat/Markdown'
export { ErrorBody, type ErrorBodyProps } from './chat/ErrorBody'
export { Transcript, type TranscriptProps } from './chat/Transcript'
export { Composer, type ComposerProps } from './chat/Composer'
export { AttachmentsRow, type AttachmentsRowProps } from './chat/AttachmentsRow'
export { QuickChips, type QuickChipsProps } from './chat/QuickChips'
export { ClipboardChip, type ClipboardChipProps } from './chat/ClipboardChip'

// Settings pieces (D3-12)
export {
  acceleratorFromEvent,
  acceleratorKeys,
  formatAccelerator,
  type RecorderKeyEvent
} from './settings/accelerator'
export { HotkeyRecorder, type HotkeyRecorderProps } from './settings/HotkeyRecorder'

// Window state (shared by every renderer)
export { applyDelta, applyPatch, type Mirror } from './state/slices'
export { useHootState } from './state/useHootState'

// Studio (D3-11)
export { SessionList, type SessionListProps } from './studio/SessionList'
export { StudioSidebar, type StudioSidebarProps } from './studio/StudioSidebar'
export { StudioLayout, type StudioLayoutProps } from './studio/StudioLayout'
export { ChatPane, type ChatPaneProps } from './studio/ChatPane'
export { QUICK_ACTION_CHIPS, toAttachmentViews, toMessageViews } from './chat/views'
export { ApiKeyField, API_KEY_URL, type ApiKeyFieldProps } from './settings/ApiKeyField'
export { SettingsPane, type SettingsPaneProps } from './settings/SettingsPane'
export { ShortcutFields, type ShortcutFieldsProps } from './settings/ShortcutFields'

// Onboarding (D3-13)
export { OnboardingPane, type OnboardingPaneProps } from './onboarding/OnboardingPane'
export { ONBOARDING_STEPS } from './onboarding/steps'

// Buddy (F-D3-1)
export { Buddy, GREETING_MS, type BuddyProps } from './buddy/Buddy'
export { BuddyCard, type BuddyCardProps } from './buddy/BuddyCard'
export type { BuddyHost } from './buddy/host'
export { capsuleRect, isGrow, layoutFits, measureHitRegions, owlRect } from './buddy/geometry'
export {
  ACK_FALLBACK_MS,
  useBuddyTransitions,
  type BuddyPart,
  type BuddyTransitions
} from './buddy/useBuddyTransitions'

// Lens (D3-13, D3-20)
export { ExtensionStatus, type ExtensionStatusProps } from './lens/ExtensionStatus'
export { ReadingPane, type ReadingPaneProps } from './lens/ReadingPane'
export { languageName, siteFromInput, siteLabel } from './lens/sites'
