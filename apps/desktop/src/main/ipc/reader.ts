import type { AppContext } from '../context'
import { handleInvoke } from './handle'

export function registerReaderIpc(ctx: AppContext): void {
  handleInvoke('reader:pickFile', () => ctx.reader.pickFile())
  handleInvoke('reader:current', () => ctx.reader.current())
}
