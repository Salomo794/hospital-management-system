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
 * The payload embeds the patient's UUID, used by the lobby kiosk and
 * the staff patient-checkin flow.
 */
export function buildCheckinPayload(patient) {
  if (!patient || !patient.uuid) return ''
  // The kiosk resolves the UUID after removing the HMS:CHECKIN: prefix.
  // Do not append the patient's name: it is display data, not an identifier.
  return `HMS:CHECKIN:${String(patient.uuid).trim()}`
}

/** Decode a scanned check-in payload back into the patient identifier. */
export function parseCheckinPayload(payload) {
  const str = String(payload || '').replace(/\x00/g, '').trim()
  const parts = str.split(':')
  if (parts[0] && parts[0].toUpperCase() === 'HMS' && parts[1] && parts[1].toUpperCase() === 'CHECKIN') {
    return { identifier: parts.slice(2).join(':') || '' }
  }
  // Fallback: payload could be a raw MRN, UUID, email or phone number.
  return { identifier: str }
}
