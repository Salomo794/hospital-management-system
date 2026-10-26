// QR code generation wrapper using the vendored qrcode-generator UMD lib.
// The lib exposes itself on globalThis.qrcode in browsers; we read it lazily.
import '../lib/qrcode-generator.js'
// The vendored library attaches `qrcode` to globalThis when loaded as a browser module.

function loadQR() {
  return globalThis.qrcode || window.qrcode
}

/**
 * Render a QR code for `text` onto a canvas element.
 * @param {string} text payload to encode
 * @param {{size?: number}} [opts] size in px (default 220)
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderQR(text, opts = {}) {
  const size = opts.size || 220
  const qr = loadQR()
  if (!qr) throw new Error('QR encoder not loaded')
  await null // keep async
  const q = qr(0, 'M') // autodetect type, error level M
  q.addData(String(text))
  q.make()
  const count = q.getModuleCount()
  const cell = Math.max(1, Math.floor(size / (count + 8)))
  const px = cell * (count + 8)
  const canvas = document.createElement('canvas')
  canvas.width = px
  canvas.height = px
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, px, px)
  const quiet = cell * 4
  ctx.fillStyle = '#0f172a'
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (q.isDark(r, c)) {
        ctx.fillRect(quiet + c * cell, quiet + r * cell, cell, cell)
      }
    }
  }
  return canvas
}

/**
 * Build the check-in payload string to encode in a QR code.
 *
 * This encodes a single-use, expiring check-in token issued by reception — it
 * must never encode an MRN, access code or patient UUID. Those are permanent
 * public identifiers and the server refuses them as credentials, so a card
 * printed with one would stop working and would leak the identifier to anyone
 * who scanned the paper.
 *
 * @param {string} token plaintext check-in token from POST /api/portal/checkin-tokens
 * @returns {string} payload, or '' when no token is available
 */
export function buildCheckinPayload(token) {
  const value = String(token || '').trim()
  if (!value) return ''
  if (value.startsWith('HMS:CHECKIN:')) return value
  return `HMS:CHECKIN:${value}`
}

/**
 * Decode a scanned check-in payload back into the single-use token.
 * Legacy payloads that carried a patient identifier are returned as-is so the
 * kiosk can submit them and let the server answer with a generic rejection.
 */
export function parseCheckinPayload(payload) {
  const str = String(payload || '').replace(/\x00/g, '').trim()
  const parts = str.split(':')
  if (parts[0] && parts[0].toUpperCase() === 'HMS' && parts[1] && parts[1].toUpperCase() === 'CHECKIN') {
    return { checkin_token: parts.slice(2).join(':') || '' }
  }
  return { checkin_token: str }
}
