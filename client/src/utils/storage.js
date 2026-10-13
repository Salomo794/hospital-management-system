function getStorage() {
  try {
    return window.localStorage
  } catch (_) {
    return null
  }
}

export function getStoredItem(key) {
  try {
    return getStorage()?.getItem(key) ?? null
  } catch (_) {
    return null
  }
}

export function setStoredItem(key, value) {
  try {
    if (value === null || value === undefined) getStorage()?.removeItem(key)
    else getStorage()?.setItem(key, String(value))
  } catch (_) {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

export function removeStoredItem(key) {
  try {
    getStorage()?.removeItem(key)
  } catch (_) {
    // Ignore unavailable storage.
  }
}

export function getStoredJson(key, validator = value => value && typeof value === 'object') {
  const raw = getStoredItem(key)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!validator(parsed)) throw new Error('Stored value has an invalid shape')
    return parsed
  } catch (_) {
    removeStoredItem(key)
    return null
  }
}

export function setStoredJson(key, value) {
  setStoredItem(key, JSON.stringify(value))
}
