// QR code generation wrapper using the vendored qrcode-generator UMD lib.
// The lib exposes itself on globalThis.qrcode in browsers; we read it lazily.
import '../../../vendor/qrcode-generator.js'
// ^ the vendored lib attaches `qrcode` to globalThis when not AMD/CommonJS

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
 * The payload embeds the patient's MRN + hospital identifier, used
 * by the lobby kiosk and the staff patient-checkin flow.
 */
export function buildCheckinPayload(patient) {
  if (!patient) return ''
  const mrn = patient.mrn || patient.patient_id || ''
  const name = patient.first_name || patient.patient_first_name || ''
  return `HMS:CHECKIN:${mrn}:${name}`.toUpperCase()
}

/** Decode a scanned check-in payload back into { mrn, name }. */
export function parseCheckinPayload(payload) {
  const str = String(payload || '').replace(/\x00/g, '').trim()
  const parts = str.split(':')
  if (parts[0] && parts[0].toUpperCase() === 'HMS' && parts[1] && parts[1].toUpperCase() === 'CHECKIN') {
    return { mrn: parts[2] || '', name: parts.slice(3).join(':') || '' }
  }
  // Fallback: payload could be a raw MRN like "MRN-ABC123"
  return { mrn: str, name: '' }
}
