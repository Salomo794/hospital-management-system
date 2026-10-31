export const DEFAULT_LOCALE = 'en'

// `tag` is the BCP 47 tag used for dates and numbers; `label` is the language's
// own name so a person can find theirs whichever language is showing.
export const LOCALES = [
  { code: 'en', label: 'English', tag: 'en-US' },
  { code: 'fr', label: 'Français', tag: 'fr-FR' },
  { code: 'rw', label: 'Kinyarwanda', tag: 'rw-RW' }
]

export const isSupportedLocale = code => LOCALES.some(l => l.code === code)

export const localeTag = code => (LOCALES.find(l => l.code === code) || LOCALES[0]).tag
