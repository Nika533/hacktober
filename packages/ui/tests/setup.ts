import { afterEach } from 'vitest'
import { cleanup } from './render'

// Tell React this is a test environment so act() warnings are meaningful.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// happy-dom's Web Animations reject `finished` on cancel, which motion
// doesn't expect. Without Element#animate motion uses its JS driver instead.
for (const proto of [Element.prototype, HTMLElement.prototype]) {
  if (Object.prototype.hasOwnProperty.call(proto, 'animate')) {
    delete (proto as { animate?: unknown }).animate
  }
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('style')
})
