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
