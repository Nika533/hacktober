/** Slack in px so sub-pixel scroll positions and a last-line nudge still count as "at the bottom". */
export const BOTTOM_SLACK = 24

export function isAtBottom(
  el: { scrollHeight: number; scrollTop: number; clientHeight: number },
  slack = BOTTOM_SLACK
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= slack
}
