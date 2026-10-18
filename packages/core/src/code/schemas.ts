import { z } from 'zod'
import { IdSchema } from '../schemas/common'
import { CODE_LIMITS } from './link'
import type {
  CodeDiagnostic,
  CodeEdit,
  CodeFile,
  CodeFocusFile,
  CodeMark,
  CodeSelection,
  CodeSnapshot,
  CodeWindowInfo,
  LineRange
} from './types'

/**
 * `@hoot/core/code/schemas`: the code link messages (VS Code extension ⇄
 * app, on the code pipe). The extension opens with `code.hello` (token +
 * protocol) and the app answers `code.welcome` or `code.error`. After that
 * the app asks (`code.snapshot.get`, `code.show`, `code.apply`,
 * `code.reveal`, `code.clear`) and the extension answers each `reqId` once;
 * the extension also pushes `code.focus` and `code.applied`.
 */

const line = z.number().int().min(1)

export const LineRangeSchema = z
  .object({ start: line, end: line })
  .refine((r) => r.end >= r.start, 'end before start') satisfies z.ZodType<LineRange>

const PathSchema = z.string().min(1).max(CODE_LIMITS.pathChars)
const UriSchema = z.string().min(1).max(CODE_LIMITS.uriChars)

export const CodeSelectionSchema = z
  .object({ start: line, end: line, text: z.string().max(CODE_LIMITS.selectionChars) })
  .refine((r) => r.end >= r.start, 'end before start') satisfies z.ZodType<CodeSelection>

export const CodeDiagnosticSchema = z.object({
  start: line,
  end: line,
  path: PathSchema,
  severity: z.enum(['error', 'warning', 'info', 'hint']),
  message: z.string().max(CODE_LIMITS.diagnosticChars),
  source: z.string().max(100).nullable()
}) satisfies z.ZodType<CodeDiagnostic>

export const CodeFileSchema = z.object({
  path: PathSchema,
  uri: UriSchema,
  languageId: z.string().max(64),
  version: z.number().int().nonnegative(),
  dirty: z.boolean(),
  lineCount: line,
  window: LineRangeSchema,
  // Lenient on purpose: the extension trims to CODE_LIMITS.fileChars, but a
  // line it can't split may run over.
  text: z.string().max(CODE_LIMITS.fileChars * 4),
  visible: z.array(LineRangeSchema).max(8),
  selection: CodeSelectionSchema.nullable()
}) satisfies z.ZodType<CodeFile>

export const CodeSnapshotSchema = z.object({
  workspace: z.string().max(200),
  active: CodeFileSchema.nullable(),
  others: z.array(CodeFileSchema).max(CODE_LIMITS.others),
  diagnostics: z.array(CodeDiagnosticSchema).max(CODE_LIMITS.diagnostics),
  excluded: z.array(PathSchema).max(8)
}) satisfies z.ZodType<CodeSnapshot>

const LabelSchema = z.string().max(CODE_LIMITS.labelChars)

export const CodeMarkSchema = z.object({
  id: IdSchema,
  path: PathSchema,
  uri: UriSchema.nullable(),
  range: LineRangeSchema,
  label: LabelSchema
}) satisfies z.ZodType<CodeMark>

export const CodeEditSchema = z.object({
  id: IdSchema,
  path: PathSchema,
  uri: UriSchema,
  range: LineRangeSchema,
  label: LabelSchema,
  replacement: z.string().max(CODE_LIMITS.replacementChars),
  expected: z.string().max(CODE_LIMITS.fileChars * 4)
}) satisfies z.ZodType<CodeEdit>

export const CodeWindowSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().max(200)
}) satisfies z.ZodType<CodeWindowInfo>

export const CodeFocusFileSchema = z.object({
  path: PathSchema,
  languageId: z.string().max(64)
}) satisfies z.ZodType<CodeFocusFile>

export const CodeErrorCodeSchema = z.enum(['unauthorized', 'version_mismatch', 'bad_request'])

const reqId = { reqId: IdSchema }

export const CodeExtToAppSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('code.hello'),
    protocol: z.number().int(),
    token: z.string().min(32).max(128),
    extVersion: z.string().max(32),
    window: CodeWindowSchema,
    focused: z.boolean(),
    file: CodeFocusFileSchema.nullable()
  }),
  // pushes
  z.object({
    type: z.literal('code.focus'),
    focused: z.boolean(),
    file: CodeFocusFileSchema.nullable()
  }),
  z.object({ type: z.literal('code.applied'), editId: IdSchema }),
  // replies
  z.object({ type: z.literal('code.snapshot'), ...reqId, snapshot: CodeSnapshotSchema.nullable() }),
  z.object({
    type: z.literal('code.done'),
    ...reqId,
    ok: z.boolean(),
    message: z.string().max(500).nullable()
  })
])

export const CodeAppToExtSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('code.welcome'),
    protocol: z.number().int(),
    appVersion: z.string().max(32)
  }),
  z.object({
    type: z.literal('code.error'),
    reqId: IdSchema.nullable(),
    code: CodeErrorCodeSchema,
    message: z.string().max(500)
  }),
  z.object({ type: z.literal('code.snapshot.get'), ...reqId }),
  /** Replace Hoot's highlights and proposed edits in this window. */
  z.object({
    type: z.literal('code.show'),
    ...reqId,
    marks: z.array(CodeMarkSchema).max(CODE_LIMITS.tags),
    edits: z.array(CodeEditSchema).max(CODE_LIMITS.tags),
    /** Scroll the first one into view when its file is the focused one. */
    reveal: z.boolean()
  }),
  z.object({ type: z.literal('code.apply'), ...reqId, edit: CodeEditSchema }),
  /** Open the file and scroll to the mark (the overlay's Show). */
  z.object({ type: z.literal('code.reveal'), ...reqId, mark: CodeMarkSchema }),
  z.object({ type: z.literal('code.clear'), ...reqId })
])

export type CodeErrorCode = z.infer<typeof CodeErrorCodeSchema>
export type CodeExtToApp = z.infer<typeof CodeExtToAppSchema>
export type CodeAppToExt = z.infer<typeof CodeAppToExtSchema>
export type CodeExtMessage<T extends CodeExtToApp['type']> = Extract<CodeExtToApp, { type: T }>
export type CodeAppMessage<T extends CodeAppToExt['type']> = Extract<CodeAppToExt, { type: T }>
