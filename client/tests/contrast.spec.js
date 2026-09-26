import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Contrast is the one design property that cannot be eyeballed: a colour that
// looks fine on one monitor is unreadable on another, and it regresses silently
// because nothing looks "broken" when the text is merely hard to read.
//
// This resolves the real custom properties out of styles.css and checks the
// actual pairs the app renders, in both themes. That is how the earlier problems
// were found: the base --success/--danger/--warning/--info values were tuned for
// borders and fills, so text using them sat at 3.3:1 in light mode, and dark mode
// never remapped them at all, so they inherited the light values onto a near-black
// surface.

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, '../src/assets/styles.css'), 'utf8')

function parseBlock(selector) {
  const start = css.indexOf(selector)
  if (start === -1) throw new Error(`no ${selector} block in styles.css`)
  const open = css.indexOf('{', start)
  let depth = 0
  let end = open
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    else if (css[index] === '}') { depth -= 1; if (depth === 0) { end = index; break } }
  }
  const vars = {}
  for (const line of css.slice(open + 1, end).split('\n')) {
    // Capture any declaration, not just hex colours: a token may legitimately be
    // defined as var(--other), and a completeness check that only recognises hex
    // would report it as missing when it is declared perfectly well.
    const match = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*;\s*$/)
    if (match) vars[match[1]] = match[2]
  }
  return vars
}

const light = parseBlock(':root {')
const dark = parseBlock('[data-theme="dark"]')

function toRgb(value) {
  let hex = value.replace('#', '')
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('')
  return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16))
}

function luminance(value) {
  const [r, g, b] = toRgb(value).map(channel => {
    const s = channel / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

// A variable missing from a theme is not "no colour", it silently inherits from
// :root. That inheritance is exactly how the semantic text colours ended up
// unreadable on a dark surface, so resolution has to cross both blocks.
function makeResolver(vars, fallback) {
  return name => {
    let value = vars[name] ?? fallback[name]
    for (let hops = 0; value && value.startsWith('var(') && hops < 5; hops += 1) {
      const inner = value.slice(4, value.indexOf(')')).trim()
      value = vars[inner] ?? fallback[inner]
    }
    return value
  }
}

const AA_TEXT = 4.5
const AA_NON_TEXT = 3.0

// [label, foreground, background, minimum ratio]
const TEXT_PAIRS = [
  ['body text', '--gray-800', '--bg-app'],
  ['card body', '--gray-800', '--surface'],
  ['card muted', '--gray-500', '--surface'],
  ['helper caption', '--text-subtle', '--surface'],
  ['helper caption on app', '--text-subtle', '--bg-app'],
  ['muted text role', '--text-muted', '--surface'],
  ['table body', '--gray-700', '--surface'],
  ['table header', '--text-muted', '--surface'],
  ['input text', '--gray-800', '--gray-100'],
  ['input placeholder', '--text-subtle', '--gray-100'],
  ['.text-success', '--success-fg', '--surface'],
  ['.text-danger', '--danger-fg', '--surface'],
  ['.text-warning', '--warning-fg', '--surface'],
  ['.text-info', '--info-fg', '--surface'],
  ['.text-muted', '--text-muted', '--surface'],
  ['validation message', '--danger-fg', '--surface'],
  ['stats change', '--danger-fg', '--surface'],
  ['success on tint', '--success-text', '--success-bg'],
  ['danger on tint', '--danger-fg', '--danger-bg'],
  ['warning on tint', '--warning-fg', '--warning-bg'],
  ['info on tint', '--info-fg', '--info-bg']
]

// A mark - an alert border, a chart series, a status dot - is not text and is
// held to 3:1 instead. These are measured against the tinted box the mark sits
// in, which is the real adjacency: an alert border runs along the edge of its own
// background, not across the page.
const MARK_PAIRS = [
  ['success alert border', '--success', '--success-bg'],
  ['danger alert border', '--danger', '--danger-bg'],
  ['warning alert border', '--warning', '--warning-bg'],
  ['info alert border', '--info', '--info-bg']
]

// A form control is a UI component, so its boundary needs 3:1. This is what
// catches a field that has no visible edge on a dark page.
const CONTROL_PAIRS = [
  ['input border', '--control-border', '--white'],
  ['input border hover', '--control-border-hover', '--white'],
  ['focus ring', '--focus-ring', '--white']
]

describe.each([
  ['light', light, light],
  ['dark', dark, light]
])('%s theme contrast', (name, vars, fallback) => {
  const resolve = makeResolver(vars, fallback)

  it.each(TEXT_PAIRS)('%s meets WCAG AA', (label, fgName, bgName) => {
    const fg = resolve(fgName)
    const bg = resolve(bgName)
    expect(fg, `${label}: ${fgName} did not resolve`).toMatch(/^#/)
    expect(bg, `${label}: ${bgName} did not resolve`).toMatch(/^#/)
    const ratio = contrast(fg, bg)
    expect(
      ratio,
      `${label} is ${ratio.toFixed(2)}:1 (${fg} on ${bg}), needs ${AA_TEXT}:1`
    ).toBeGreaterThanOrEqual(AA_TEXT)
  })

  it.each(CONTROL_PAIRS)('%s meets the 3:1 non-text minimum', (label, fgName, bgName) => {
    const fg = resolve(fgName)
    const bg = resolve(bgName)
    expect(fg, `${label}: ${fgName} did not resolve`).toMatch(/^#/)
    const ratio = contrast(fg, bg)
    expect(
      ratio,
      `${label} is ${ratio.toFixed(2)}:1 (${fg} on ${bg}), needs ${AA_NON_TEXT}:1`
    ).toBeGreaterThanOrEqual(AA_NON_TEXT)
  })

  it.each(MARK_PAIRS)('%s meets the 3:1 mark minimum', (label, fgName, bgName) => {
    const fg = resolve(fgName)
    const bg = resolve(bgName)
    expect(fg, `${label}: ${fgName} did not resolve`).toMatch(/^#/)
    const ratio = contrast(fg, bg)
    expect(
      ratio,
      `${label} is ${ratio.toFixed(2)}:1 (${fg} on ${bg}), needs ${AA_NON_TEXT}:1`
    ).toBeGreaterThanOrEqual(AA_NON_TEXT)
  })
})

describe('theme completeness', () => {
  // Every semantic colour the app uses as a mark or as text has to be defined in
  // both themes. An undefined one is not a gap, it is a silent inheritance from
  // the light theme, which is what made text unreadable in dark mode.
  const required = [
    '--success', '--danger', '--warning', '--info',
    '--success-bg', '--danger-bg', '--warning-bg', '--info-bg',
    '--success-fg', '--danger-fg', '--warning-fg', '--info-fg',
    '--text-primary', '--text-secondary', '--text-muted', '--text-subtle',
    '--control-border', '--control-border-hover', '--focus-ring',
    '--surface', '--bg-app', '--white', '--gray-100'
  ]

  it.each(required)('dark theme defines %s', (name) => {
    expect(dark[name], `${name} is undefined in [data-theme="dark"]`).toBeTruthy()
  })

  it.each(required)('light theme defines %s', (name) => {
    expect(light[name], `${name} is undefined in :root`).toBeTruthy()
  })
})

describe('decorative borders are exempt', () => {
  // Hairline dividers sit well below 3:1 on purpose. WCAG requires that for UI
  // components that convey state, not for a line that only separates one table
  // section from the next. Pinning that decision here stops someone "fixing" it
  // later and making every card look ruled.
  it.each([
    ['light divider', light, '--gray-200', '--surface'],
    ['dark divider', dark, '--gray-200', '--surface']
  ])('%s is allowed to stay faint', (label, vars, fgName, bgName) => {
    const ratio = contrast(vars[fgName], vars[bgName])
    expect(ratio).toBeGreaterThan(1)
    expect(ratio).toBeLessThan(AA_NON_TEXT)
  })
})
