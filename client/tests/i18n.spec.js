import { describe, it, expect } from 'vitest'
import { messages } from '../src/i18n/messages'
import { translate } from '../src/i18n'
import { LOCALES, isSupportedLocale, localeTag } from '../src/i18n/locales'

const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()

describe('translations', () => {
  const english = messages.en

  it('has a message table for every listed locale', () => {
    for (const { code } of LOCALES) expect(messages[code], code).toBeTruthy()
  })

  for (const { code } of LOCALES.filter(l => l.code !== 'en')) {
    it(`${code} defines exactly the English keys`, () => {
      const missing = Object.keys(english).filter(k => !(k in messages[code]))
      const extra = Object.keys(messages[code]).filter(k => !(k in english))
      expect({ missing, extra }).toEqual({ missing: [], extra: [] })
    })

    it(`${code} keeps every placeholder`, () => {
      const broken = Object.keys(english).filter(
        k => k in messages[code] && placeholders(english[k]).join() !== placeholders(messages[code][k]).join()
      )
      expect(broken).toEqual([])
    })

    it(`${code} has no empty strings`, () => {
      const empty = Object.entries(messages[code]).filter(([, v]) => !String(v).trim()).map(([k]) => k)
      expect(empty).toEqual([])
    })
  }
})

describe('translate', () => {
  it('substitutes placeholders', () => {
    expect(translate('en', 'dash.greeting.morning', { name: 'Aline' })).toBe('Good morning, Aline')
    expect(translate('fr', 'dash.minAgo', { n: 5 })).toBe('il y a 5 min')
  })

  it('falls back to English, then to the key', () => {
    expect(translate('xx', 'nav.patients')).toBe('Patients')
    expect(translate('en', 'no.such.key')).toBe('no.such.key')
  })

  it('leaves a placeholder visible when its value is missing', () => {
    expect(translate('en', 'dash.updated')).toBe('Updated {when}')
  })
})

describe('locales', () => {
  it('recognises supported codes only', () => {
    expect(isSupportedLocale('rw')).toBe(true)
    expect(isSupportedLocale('de')).toBe(false)
    expect(isSupportedLocale(null)).toBe(false)
  })

  it('maps a code to its formatting tag, defaulting to English', () => {
    expect(localeTag('fr')).toBe('fr-FR')
    expect(localeTag('zz')).toBe('en-US')
  })
})
