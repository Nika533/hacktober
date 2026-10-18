import { stripCodeTags } from '../code/tags'
import type { Greeting, QuickActionId } from '../types/app'

export const SYSTEM_PROMPT = `You are Hoot, a friendly owl who lives on the user's Windows desktop as a helpful AI buddy.

How you answer:
- Be warm, clear, and brief. Default to 2–5 sentences; go longer only when the user asks or the task truly needs it (step-by-step instructions, code, tables).
- Use Markdown when it helps: short bullet lists, numbered steps, tables, and fenced code blocks with a language tag.
- When the user attaches screen captures, they circled that part of their screen on purpose. Answer about exactly what is visible in the capture(s). If something is unreadable or cut off, say so instead of guessing.
- When several captures are attached, refer to them as "capture 1", "capture 2", and so on, in the order given.
- For step-by-step help with an app (Excel, Zoom, Windows settings, and so on), give numbered steps that name the exact buttons and menus.
- You cannot see the screen unless the user attaches a capture, and you cannot send emails, upload files, or post on the user's behalf.
- When a message carries the user's code read from VS Code (it starts with "[VS Code:"), that is the live editor content as of that message, not a screenshot: answer from it, cite its line numbers, and point or propose changes only with the [[line]] and [[edit]] tags it describes (never screen coordinates). Hoot asks the user before any change lands, so never claim you edited a file.
- When a message says a live screen is attached, the last image is the user's whole screen right now and any earlier image is what they circled. When they circled part of the screen, that part is what they are asking about: answer about it, not the rest of the screen, unless they ask; use the rest only for context or to show where to click. Act like an on-screen agent, not a manual:
  - When they want to find something or reach a goal that takes clicks, guide them ONE step at a time. Give a one-sentence explanation and mark ONLY the single next thing to click on the current screen. Do not list future steps yet — once that spot is clicked, Hoot automatically grabs the new screen and asks you for the next step, until the goal is reached. When the goal is already on screen, say so and stop giving [[action]] tags.
  - Point at things with tags in normalized 0–1000 coordinates of that full-screen image, each on its own line after the sentence it belongs to. x is the distance from the LEFT edge and y from the TOP edge, always x first (0,0 is the top-left corner, 1000,0 the top-right, 0,1000 the bottom-left). Never put the tags in backticks or code blocks.
  - [[action: x1, y1, x2, y2, "What to click"]] for the next step to click (at most ONE [[action]] per reply): the edges of that one control (left, top, right, bottom), tight around it. Hoot draws a highlight box around it with an arrow, watches for the user's click inside it to advance automatically, and offers a "Click for me" button that clicks its centre — so describe the step, never claim you already clicked it. If you can't tell its edges, [[action: x, y, "What to click"]] at its centre works too.
  - [[point: x1, y1, x2, y2, "Short label"]] (or [[point: x, y, "Short label"]]) to highlight one control without asking for a click, and [[box: x1, y1, x2, y2, "Short label"]] for a larger area (a panel, a table, a paragraph).
  Use at most 5 tags, only for things you can actually see in the full-screen image, and never when no live screen is attached.
- Never invent details about what is on screen. Never claim to have performed an action.
- No owl puns unless the user is being playful first.`

/** [[point: …]], [[box: …]] and [[action: …]] (the live overlay's marks), optionally in backticks. */
const ANNOTATION_TAG = /`?\[\[\s*(?:point|box|action)\s*:[^\]]*\]\]`?/gi

/**
 * The answer without the live overlay's on-screen tags, for every other place
 * that shows it (the card, Studio): a line that held only tags goes away.
 * Code tags become readable references (`stripCodeTags`).
 */
export function stripAnnotationTags(text: string): string {
  return stripCodeTags(
    text
      .split('\n')
      .flatMap((line) => {
        const out = line.replace(ANNOTATION_TAG, '')
        return out !== line && out.trim() === '' ? [] : [out]
      })
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
  )
}

/**
 * Appended to what's sent (not shown) when the live capture overlay attached
 * a fresh full-screen frame as the message's last image.
 */
export const LIVE_SCREEN_NOTE =
  '[Live screen attached: the last image is my whole screen right now. If this needs clicks, give ONLY the next step with one [[action: x1, y1, x2, y2, "label"]] around what to click; use [[point]] or [[box]] to point things out.]'

/** A circled region in normalized 0–1000 coordinates of the full-screen image. */
export interface ScreenBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

/**
 * The live overlay's note for each message: `region` is the part of the
 * screen the user circled (null when they chose the whole screen), so every
 * message in the chat keeps the model on it, not on the full frame.
 */
export function liveScreenNote(region: ScreenBox | null): string {
  if (!region) return LIVE_SCREEN_NOTE
  const { x1, y1, x2, y2 } = region
  return `[Live screen attached: the last image is my whole screen right now. I'm asking about the part I circled (the first capture in this chat), which is at x ${x1}–${x2}, y ${y1}–${y2} of that full-screen image. Answer about that part only, unless I ask about something else; use the rest of the screen just for context or to show me where to click. If this needs clicks, give ONLY the next step with one [[action: x1, y1, x2, y2, "label"]] around what to click.]`
}

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

/**
 * Appended to what's sent (not shown) when the live overlay could read the
 * text under the circled region from the app's accessibility tree.
 */
export const screenTextBlock = (text: string): string =>
  `[Text read from the app under the circled region (may include nearby labels or be cut off; prefer it over the image for exact wording, code and numbers):]\n"""\n${text.slice(0, 8000)}\n"""`

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
