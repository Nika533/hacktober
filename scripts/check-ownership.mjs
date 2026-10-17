/**
 * Fails a PR whose branch is `<builder>/...` (c, d1, d2, d3) when it changes
 * a path that builder doesn't own (scripts/ownership.json). Other branches
 * pass with a notice. The PR label `ownership-override` skips the check.
 *
 *   node scripts/check-ownership.mjs --base origin/main --branch d2/D2-10-inline
 *   node scripts/check-ownership.mjs --branch d1/x --files a.ts b.ts
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** Glob → RegExp: `**` any depth, `*` within a segment, `?` one char, `{a,b}` alternatives. */
export function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++
        if (glob[i + 1] === '/') {
          i++
          re += '(?:.*/)?'
        } else {
          re += '.*'
        }
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') re += '[^/]'
    else if (c === '{') {
      const end = glob.indexOf('}', i)
      const alts = glob.slice(i + 1, end).split(',')
      re += `(?:${alts.map((a) => a.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`
      i = end
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

/** Gitignore-style: the last matching pattern decides; `!` excludes. */
export function isAllowed(path, patterns) {
  let allowed = false
  for (const p of patterns) {
    const negated = p.startsWith('!')
    if (globToRegExp(negated ? p.slice(1) : p).test(path)) allowed = !negated
  }
  return allowed
}

export function builderOf(branch) {
  const m = /^(c|d1|d2|d3)\//.exec(branch ?? '')
  return m ? m[1] : null
}

export function findViolations(builder, files, rules) {
  const patterns = [...rules.shared, ...(rules.builders[builder] ?? [])]
  return files.filter((f) => !isAllowed(f, patterns))
}

function arg(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

function hasOverrideLabel() {
  const eventPath = process.env.GITHUB_EVENT_PATH
  if (!eventPath) return false
  try {
    const event = JSON.parse(readFileSync(eventPath, 'utf8'))
    return (event.pull_request?.labels ?? []).some((l) => l.name === 'ownership-override')
  } catch {
    return false
  }
}

function main() {
  const branch = arg('--branch') ?? process.env.GITHUB_HEAD_REF ?? ''
  const builder = builderOf(branch)
  if (!builder) {
    console.log(`ownership: branch "${branch}" has no builder prefix; skipping`)
    return 0
  }
  if (hasOverrideLabel()) {
    console.log('ownership: skipped by the ownership-override label')
    return 0
  }
  const filesArg = process.argv.indexOf('--files')
  const files =
    filesArg >= 0
      ? process.argv.slice(filesArg + 1)
      : execFileSync(
          'git',
          ['diff', '--name-only', '--no-renames', `${arg('--base') ?? 'origin/main'}...HEAD`],
          { encoding: 'utf8' }
        )
          .split('\n')
          .filter(Boolean)
  const rules = JSON.parse(readFileSync(join(here, 'ownership.json'), 'utf8'))
  const violations = findViolations(builder, files, rules)
  if (violations.length === 0) {
    console.log(`ownership: ${files.length} file(s) changed, all owned by ${builder}`)
    return 0
  }
  console.error(`ownership: ${builder} changed paths it doesn't own:`)
  for (const v of violations) console.error(`  ${v}`)
  console.error(
    'Ask the owner (write it under Requests in your docs/status file) or have C add the ownership-override label.'
  )
  return 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main())
