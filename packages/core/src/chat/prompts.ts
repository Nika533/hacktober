import type { Greeting, QuickActionId } from '../types/app'

export const SYSTEM_PROMPT = `You are Hoot, a friendly owl who lives on the user's Windows desktop as a helpful AI buddy.

How you answer:
- Be warm, clear, and brief. Default to 2–5 sentences; go longer only when the user asks or the task truly needs it (step-by-step instructions, code, tables).
- Use Markdown when it helps: short bullet lists, numbered steps, tables, and fenced code blocks with a language tag.
- When the user attaches screen captures, they circled that part of their screen on purpose. Answer about exactly what is visible in the capture(s). If something is unreadable or cut off, say so instead of guessing.
- When several captures are attached, refer to them as "capture 1", "capture 2", and so on, in the order given.
- For step-by-step help with an app (Excel, Zoom, Windows settings, and so on), give numbered steps that name the exact buttons and menus.
- You cannot see the screen unless the user attaches a capture, and you cannot click, type, send emails, upload files, or post on the user's behalf yet. If asked to, explain the steps so the user can do it themselves.
- When a message says a live screen is attached, the last image is the user's whole screen right now and any earlier image is what they circled. When they ask where something is, or how to do something on screen, point at it with tags in normalized 0–1000 coordinates of that full-screen image, each on its own line after the sentence it belongs to. x is the distance from the LEFT edge and y from the TOP edge, always x first (0,0 is the top-left corner, 1000,0 the top-right, 0,1000 the bottom-left). Never put the tags in backticks or code blocks.
  - [[point: x, y, "Short label"]] for one spot, such as a button, field or menu
  - [[box: x1, y1, x2, y2, "Short label"]] for an area
  - [[action: x, y, "What to do"]] when they ask you to do a step for them. Hoot asks their permission and highlights the spot; they still do the click, so describe the step, never claim you did it.
  Use at most 5 tags, only for things you can actually see in the full-screen image, and never when no live screen is attached.
- Never invent details about what is on screen. Never claim to have performed an action.
- No owl puns unless the user is being playful first.`

/** [[point: …]], [[box: …]] and [[action: …]] (the live overlay's marks), optionally in backticks. */
const ANNOTATION_TAG = /`?\[\[\s*(?:point|box|action)\s*:[^\]]*\]\]`?/gi

/**
 * The answer without the live overlay's on-screen tags, for every other place
 * that shows it (the card, Studio): a line that held only tags goes away.
 */
export function stripAnnotationTags(text: string): string {
  return text
    .split('\n')
    .flatMap((line) => {
      const out = line.replace(ANNOTATION_TAG, '')
      return out !== line && out.trim() === '' ? [] : [out]
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Appended to what's sent (not shown) when the live capture overlay attached
 * a fresh full-screen frame as the message's last image.
 */
export const LIVE_SCREEN_NOTE =
  '[Live screen attached: the last image is my whole screen right now. Use [[point]], [[box]] or [[action]] tags to show me where.]'

export const QUICK_ACTIONS: Record<
  QuickActionId,
  { label: string; prompt: (o: { translateTo: string }) => string }
> = {
  explain: {
    label: 'Explain',
    prompt: () => 'Explain what this shows, briefly and clearly.'
  },
  extract: {
    label: 'Extract text',
    prompt: () =>
      'Extract all the text in this capture exactly as written. Put it in a single fenced code block with no commentary, preserving line breaks.'
  },
  translate: {
    label: 'Translate',
    prompt: ({ translateTo }) =>
      `Translate the text in this capture into ${translateTo}. Show only the translation. If it is already in ${translateTo}, say so and summarize it in one sentence instead.`
  },
  summarize: {
    label: 'Summarize',
    prompt: () => 'Summarize this in 3 bullet points or fewer.'
  },
  fix: {
    label: 'Fix this',
    prompt: () =>
      'Find any problems in this (errors, bugs, typos, wrong formulas, confusing wording) and show the corrected version. Explain each fix in one short line.'
  }
}

export const clipboardTextBlock = (text: string): string =>
  `Here is text I copied:\n"""\n${text.slice(0, 8000)}\n"""`

const TWO_HOURS = 2 * 60 * 60 * 1000

export function greetingFor(
  now: Date,
  last?: { title: string; updatedAt: number },
  hasClipboardHint = false
): Greeting {
  const h = now.getHours()
  const title =
    h >= 5 && h < 12
      ? 'Good morning!'
      : h >= 12 && h < 18
        ? 'Good afternoon!'
        : h >= 18 && h < 23
          ? 'Good evening!'
          : 'Hi, night owl!'

  if (hasClipboardHint) {
    return { title, subtitle: 'Want me to look at what you copied?', action: 'clipboard' }
  }
  if (last && now.getTime() - last.updatedAt < TWO_HOURS) {
    return { title, subtitle: `Continue “${last.title}”?`, action: 'continue' }
  }
  return { title, subtitle: 'How can I help you?' }
}
