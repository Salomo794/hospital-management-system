import { messages } from './messages'
import { useUiStore } from '../store/ui'
import { DEFAULT_LOCALE, LOCALES, isSupportedLocale, localeTag } from './locales'

export { DEFAULT_LOCALE, LOCALES, isSupportedLocale, localeTag }

// Looks a key up in the chosen language, then English, then falls back to the
// key itself so a missing string is visible rather than blank.
export function translate(locale, key, params = {}) {
  const template = messages[locale]?.[key] ?? messages[DEFAULT_LOCALE][key] ?? key
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    params[name] === undefined || params[name] === null ? match : String(params[name])
  )
}

// Reads the locale from the UI store, so anything that calls `t()` while
// rendering or inside a computed re-runs when the language changes.
export function useI18n() {
  const ui = useUiStore()
  const t = (key, params) => translate(ui.locale, key, params)
  return {
    t,
    ui,
    get locale() { return ui.locale },
    get tag() { return localeTag(ui.locale) }
  }
}
