/** Default copy action: the async Clipboard API. Hosts can pass their own (IPC). */
export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

export type CopyFn = (text: string) => void | Promise<void>
