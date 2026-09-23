<template>
  <!-- ── MODAL SHELL ── -->
  <Teleport to="body">
    <Transition name="card-pop">
      <div class="pac-overlay" v-if="visible" @click.self="$emit('close')">
        <div class="pac-wrap" role="dialog" aria-modal="true" aria-labelledby="pac-title">

          <!-- close btn -->
          <button class="pac-x" @click="$emit('close')" aria-label="Close">✕</button>

          <!-- ── SUCCESS BANNER ── -->
          <div class="pac-success-banner">
            <span class="pac-check">✓</span>
            <div>
              <div class="pac-success-title">Patient Registered Successfully!</div>
              <div class="pac-success-sub">Give this card to the patient — they will need it to see a doctor.</div>
            </div>
          </div>

          <!-- ── THE CARD (printable) ── -->
          <div class="pac-card-outer" id="pac-print-root">
            <div class="pac-card">

              <!-- card header -->
              <div class="pac-card-header">
                <div class="pac-logo-mark">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                </div>
                <div class="pac-hospital-info">
                  <span class="pac-hospital-name">MediCare Hospital</span>
                  <span class="pac-hospital-tag">Patient Access Card</span>
                </div>
                <div class="pac-card-type-badge">OFFICIAL</div>
              </div>

              <!-- avatar + name -->
              <div class="pac-patient-identity">
                <div class="pac-avatar">
                  {{ initials }}
                </div>
                <div class="pac-id-info">
                  <div class="pac-patient-name" id="pac-title">{{ patient.first_name }} {{ patient.last_name }}</div>
                  <div class="pac-patient-sub">
                    <span class="pac-gender-badge">{{ patient.gender }}</span>
                    <span v-if="patient.date_of_birth">· DOB {{ formatDob(patient.date_of_birth) }}</span>
                    <span v-if="patient.blood_type" class="pac-blood">· {{ patient.blood_type }}</span>
                  </div>
                </div>
              </div>

              <!-- divider wave -->
              <div class="pac-wave" aria-hidden="true">
                <svg viewBox="0 0 400 18" preserveAspectRatio="none"><path d="M0,9 C80,18 160,0 240,9 C320,18 380,4 400,9 L400,18 L0,18Z" fill="rgba(255,255,255,0.08)"/></svg>
              </div>

              <!-- ── CREDENTIALS GRID ── -->
              <div class="pac-creds">

                <!-- MRN -->
                <div class="pac-cred pac-cred--mrn">
                  <div class="pac-cred-label">
                    <span class="pac-cred-icon">🏥</span> Medical Record No.
                  </div>
                  <div class="pac-cred-value pac-mono">{{ patient.mrn }}</div>
                </div>

                <!-- Access Code — THE BIG ONE -->
                <div class="pac-cred pac-cred--code">
                  <div class="pac-cred-label">
                    <span class="pac-cred-icon">🔑</span> Patient Access Code
                  </div>
                  <div class="pac-code-display">
                    <span
                      v-for="(chunk, i) in codeChunks"
                      :key="i"
                      class="pac-code-chunk"
                    >{{ chunk }}</span>
                  </div>
                  <div class="pac-code-hint">Show this code to your doctor or nurse</div>
                </div>

                <!-- Portal PIN -->
                <div class="pac-cred pac-cred--pin">
                  <div class="pac-cred-label">
                    <span class="pac-cred-icon">🔒</span> Portal PIN
                  </div>
                  <div class="pac-pin-row">
                    <div class="pac-pin-boxes">
                      <span
                        v-for="(digit, i) in pinDigits"
                        :key="i"
                        class="pac-pin-box"
                        :class="{ 'pac-pin-box--hidden': !showPin }"
                      >{{ showPin ? digit : '•' }}</span>
                    </div>
                    <button class="pac-reveal-btn" @click="showPin = !showPin" type="button" :title="showPin ? 'Hide PIN' : 'Show PIN'">
                      {{ showPin ? '🙈' : '👁' }}
                    </button>
                  </div>
                  <div class="pac-pin-hint">Use to log in to the Patient Portal</div>
                </div>

              </div>

              <!-- ── QR-STYLE CODE MATRIX ── -->
              <div class="pac-qr-area">
                <canvas ref="qrCanvas" class="pac-qr-canvas" width="90" height="90" aria-label="Visual code pattern" />
                <div class="pac-qr-info">
                  <div class="pac-qr-label">Scan or type code above</div>
                  <div class="pac-qr-issued">Issued: {{ today }}</div>
                  <div class="pac-qr-valid">Valid indefinitely</div>
                </div>
              </div>

              <!-- card footer -->
              <div class="pac-card-footer">
                <div class="pac-footer-note">
                  ⚠ Keep this card safe. Your access code is unique and cannot be recovered.
                </div>
                <div class="pac-footer-watermark">MediCare HMS · {{ patient.mrn }}</div>
              </div>

            </div>
          </div>

          <!-- ── ACTION BUTTONS ── -->
          <div class="pac-actions">
            <button class="pac-btn pac-btn--print" @click="printCard" type="button">
              <span>🖨</span> Print Card
            </button>
            <button class="pac-btn pac-btn--copy" @click="copyCode" type="button">
              <span>{{ copied ? '✓' : '📋' }}</span> {{ copied ? 'Copied!' : 'Copy Code' }}
            </button>
            <button class="pac-btn pac-btn--new" @click="$emit('register-another')" type="button">
              <span>＋</span> Register Another
            </button>
            <button class="pac-btn pac-btn--done" @click="$emit('close')" type="button">
              Done
            </button>
          </div>

          <!-- print tip -->
          <p class="pac-print-tip">💡 Click <strong>Print Card</strong> to save as PDF or print for the patient.</p>

        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script>
import { ref, computed, onMounted, watch, nextTick } from 'vue'

export default {
  name: 'PatientAccessCard',
  emits: ['close', 'register-another'],
  props: {
    visible:  { type: Boolean, default: false },
    patient:  { type: Object,  required: true },
    plainPin: { type: String,  default: '' },
  },
  setup(props) {
    const showPin  = ref(false)
    const copied   = ref(false)
    const qrCanvas = ref(null)

    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

    const initials = computed(() => {
      const f = (props.patient.first_name || '').charAt(0).toUpperCase()
      const l = (props.patient.last_name  || '').charAt(0).toUpperCase()
      return f + l
    })

    /** Split "HMS-L9XQ-R4A2B" → ['HMS', 'L9XQ', 'R4A2B'] */
    const codeChunks = computed(() =>
      (props.patient.access_code || '').split('-').filter(Boolean)
    )

    const pinDigits = computed(() =>
      (props.plainPin || '------').split('')
    )

    const formatDob = (dob) => {
      if (!dob) return ''
      const d = new Date(dob + 'T00:00:00')
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }

    /** Draw a deterministic dot-matrix from the access code string */
    const drawQr = () => {
      const canvas = qrCanvas.value
      if (!canvas || !props.patient.access_code) return
      const ctx  = canvas.getContext('2d')
      const code = props.patient.access_code
      const size = 90
      const cell = size / 11          // 11×11 grid
      ctx.clearRect(0, 0, size, size)

      // Seed from code characters
      let seed = 0
      for (let i = 0; i < code.length; i++) seed += code.charCodeAt(i) * (i + 1)
      const rng = (s) => { s = (s * 9301 + 49297) % 233280; return s / 233280 }

      let s = seed
      for (let row = 0; row < 11; row++) {
        for (let col = 0; col < 11; col++) {
          s = Math.floor(rng(s) * 233280)
          const on = rng(s) > 0.48
          // Force corner finder squares (top-left, top-right, bottom-left)
          const corner = (row < 3 && col < 3) || (row < 3 && col > 7) || (row > 7 && col < 3)
          const active = corner ? ((row === 0 || row === 2 || col === 0 || col === 2) || (row === 1 && col === 1)) : on
          if (active) {
            ctx.fillStyle = corner ? '#0d9488' : 'rgba(255,255,255,0.85)'
            const radius = cell * 0.3
            const x = col * cell + 1, y = row * cell + 1, w = cell - 2, h = cell - 2
            ctx.beginPath()
            ctx.moveTo(x + radius, y)
            ctx.lineTo(x + w - radius, y)
            ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
            ctx.lineTo(x + w, y + h - radius)
            ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
            ctx.lineTo(x + radius, y + h)
            ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
            ctx.lineTo(x, y + radius)
            ctx.quadraticCurveTo(x, y, x + radius, y)
            ctx.closePath()
            ctx.fill()
          }
        }
      }
    }

    watch(() => [props.visible, props.patient?.access_code], async ([v]) => {
      if (v) { await nextTick(); drawQr() }
    }, { immediate: true })

    onMounted(() => { if (props.visible) drawQr() })

    const copyCode = async () => {
      try {
        await navigator.clipboard.writeText(props.patient.access_code || '')
        copied.value = true
        setTimeout(() => (copied.value = false), 2500)
      } catch { /* silent */ }
    }

    const printCard = () => {
      const el = document.getElementById('pac-print-root')
      if (!el) return
      const win = window.open('', '_blank', 'width=700,height=600')
      win.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Patient Access Card — ${props.patient.first_name} ${props.patient.last_name}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
            * { margin:0; padding:0; box-sizing:border-box; }
            body { background:#0d1a2a; display:flex; align-items:center; justify-content:center; min-height:100vh; font-family:Inter,sans-serif; }
          </style>
        </head>
        <body>
          ${el.outerHTML}
          <script>
            window.onload = function() {
              // Replace canvas with a blank placeholder for print
              document.querySelectorAll('canvas').forEach(c => {
                const d = document.createElement('div');
                d.style.cssText = 'width:90px;height:90px;background:rgba(255,255,255,0.1);border-radius:8px;';
                c.replaceWith(d);
              });
              window.print();
              setTimeout(() => window.close(), 800);
            }
          <\/script>
        </body>
        </html>
      `)
      win.document.close()
    }

    return { showPin, copied, qrCanvas, today, initials, codeChunks, pinDigits, formatDob, copyCode, printCard }
  }
}
</script>

<style scoped>
/* ══ OVERLAY ══ */
.pac-overlay {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(5, 15, 30, 0.82);
  backdrop-filter: blur(10px);
  display: flex; align-items: center; justify-content: center;
  padding: 20px; overflow-y: auto;
}

/* ══ WRAPPER ══ */
.pac-wrap {
  position: relative;
  width: 100%; max-width: 560px;
  display: flex; flex-direction: column; gap: 20px;
}

.pac-x {
  position: absolute; top: -14px; right: -14px;
  width: 32px; height: 32px; border-radius: 50%;
  background: rgba(255,255,255,.15); border: 1px solid rgba(255,255,255,.2);
  color: #fff; font-size: 14px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .2s;
  z-index: 1;
}
.pac-x:hover { background: rgba(255,255,255,.28); }

/* ══ SUCCESS BANNER ══ */
.pac-success-banner {
  background: linear-gradient(135deg, #065f46, #0d9488);
  border-radius: 14px; padding: 16px 20px;
  display: flex; align-items: center; gap: 14px;
  box-shadow: 0 4px 20px rgba(13,148,136,.4);
  animation: bannerIn .4s cubic-bezier(.34,1.46,.64,1) both;
}
.pac-check {
  width: 38px; height: 38px; border-radius: 50%;
  background: rgba(255,255,255,.2); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 700; flex-shrink: 0;
}
.pac-success-title { font-size: 15px; font-weight: 700; color: #fff; }
.pac-success-sub   { font-size: 12.5px; color: rgba(255,255,255,.75); margin-top: 2px; }

/* ══ CARD OUTER ══ */
.pac-card-outer {
  animation: cardIn .5s cubic-bezier(.34,1.3,.64,1) .1s both;
}

/* ══ THE CARD ══ */
.pac-card {
  background: linear-gradient(145deg, #0a2a3a 0%, #0d3346 40%, #071e2c 100%);
  border-radius: 20px;
  border: 1px solid rgba(255,255,255,.1);
  box-shadow:
    0 0 0 1px rgba(13,148,136,.3),
    0 30px 60px rgba(0,0,0,.5),
    inset 0 1px 0 rgba(255,255,255,.08);
  overflow: hidden;
  position: relative;
}

/* Ambient glow */
.pac-card::before {
  content: '';
  position: absolute; top: -80px; right: -60px;
  width: 260px; height: 260px; border-radius: 50%;
  background: radial-gradient(circle, rgba(13,148,136,.25) 0%, transparent 70%);
  pointer-events: none;
}
.pac-card::after {
  content: '';
  position: absolute; bottom: -60px; left: -40px;
  width: 200px; height: 200px; border-radius: 50%;
  background: radial-gradient(circle, rgba(37,99,235,.15) 0%, transparent 70%);
  pointer-events: none;
}

/* ── card header ── */
.pac-card-header {
  display: flex; align-items: center; gap: 12px;
  padding: 18px 22px 14px;
}
.pac-logo-mark {
  width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0;
  background: linear-gradient(135deg, #14b8a6, #0d9488);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(20,184,166,.4);
}
.pac-logo-mark svg { width: 20px; height: 20px; stroke: #fff; }
.pac-hospital-info { flex: 1; display: flex; flex-direction: column; gap: 1px; }
.pac-hospital-name { font-size: 14px; font-weight: 700; color: #fff; letter-spacing: -.01em; }
.pac-hospital-tag  { font-size: 10px; color: rgba(255,255,255,.45); letter-spacing: .1em; text-transform: uppercase; }
.pac-card-type-badge {
  font-size: 9.5px; font-weight: 700; letter-spacing: .14em;
  padding: 3px 9px; border-radius: 20px;
  background: rgba(20,184,166,.18); color: #5eead4;
  border: 1px solid rgba(20,184,166,.3);
}

/* ── patient identity ── */
.pac-patient-identity {
  display: flex; align-items: center; gap: 14px;
  padding: 0 22px 16px;
}
.pac-avatar {
  width: 52px; height: 52px; border-radius: 50%; flex-shrink: 0;
  background: linear-gradient(135deg, #14b8a6, #0d9488);
  color: #fff; font-size: 20px; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 16px rgba(13,148,136,.45);
  border: 2.5px solid rgba(255,255,255,.2);
}
.pac-patient-name { font-size: 22px; font-weight: 800; color: #fff; letter-spacing: -.03em; }
.pac-patient-sub  { font-size: 12px; color: rgba(255,255,255,.55); margin-top: 4px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.pac-gender-badge {
  background: rgba(255,255,255,.1); padding: 1px 8px;
  border-radius: 20px; font-size: 11px; text-transform: capitalize;
}
.pac-blood { color: #f87171; font-weight: 600; }

/* ── wave divider ── */
.pac-wave { width: 100%; line-height: 0; margin: -2px 0 0; }
.pac-wave svg { display: block; width: 100%; height: 18px; }

/* ── credentials ── */
.pac-creds {
  display: flex; flex-direction: column; gap: 0;
  padding: 0 22px 6px;
}

.pac-cred {
  padding: 14px 0;
  border-bottom: 1px solid rgba(255,255,255,.07);
}
.pac-cred:last-child { border-bottom: none; }

.pac-cred-label {
  font-size: 10.5px; font-weight: 600; letter-spacing: .1em;
  text-transform: uppercase; color: rgba(255,255,255,.4);
  display: flex; align-items: center; gap: 6px; margin-bottom: 8px;
}
.pac-cred-icon { font-size: 13px; }

/* MRN value */
.pac-cred-value.pac-mono {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 16px; font-weight: 700; color: var(--gray-200);
  letter-spacing: .08em;
}

/* ── Access code ── */
.pac-cred--code { }
.pac-code-display {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  margin-bottom: 6px;
}
.pac-code-chunk {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 22px; font-weight: 800; letter-spacing: .06em;
  color: #fff;
  background: rgba(20,184,166,.15);
  border: 1.5px solid rgba(20,184,166,.35);
  padding: 6px 12px; border-radius: 10px;
  text-shadow: 0 0 20px rgba(20,184,166,.5);
  transition: background .2s;
}
.pac-code-chunk:first-child { color: #5eead4; }
.pac-code-hint { font-size: 11.5px; color: rgba(255,255,255,.4); }

/* ── PIN ── */
.pac-pin-row {
  display: flex; align-items: center; gap: 12px; margin-bottom: 6px;
}
.pac-pin-boxes { display: flex; gap: 6px; }
.pac-pin-box {
  width: 34px; height: 40px; border-radius: 8px;
  background: rgba(255,255,255,.07); border: 1.5px solid rgba(255,255,255,.14);
  color: #fff; font-size: 18px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  font-family: 'JetBrains Mono', monospace;
  transition: all .2s;
}
.pac-pin-box--hidden { letter-spacing: 0; font-size: 22px; color: rgba(255,255,255,.4); }
.pac-reveal-btn {
  background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12);
  width: 34px; height: 34px; border-radius: 8px; cursor: pointer;
  font-size: 16px; display: flex; align-items: center; justify-content: center;
  transition: background .2s;
}
.pac-reveal-btn:hover { background: rgba(255,255,255,.16); }
.pac-pin-hint { font-size: 11.5px; color: rgba(255,255,255,.4); }

/* ── QR area ── */
.pac-qr-area {
  display: flex; align-items: center; gap: 16px;
  padding: 14px 22px;
  background: rgba(0,0,0,.2);
  margin: 0 0 0;
  border-top: 1px solid rgba(255,255,255,.06);
}
.pac-qr-canvas {
  border-radius: 10px;
  background: rgba(255,255,255,.06);
  border: 1px solid rgba(255,255,255,.1);
  flex-shrink: 0;
}
.pac-qr-info { display: flex; flex-direction: column; gap: 4px; }
.pac-qr-label  { font-size: 11.5px; font-weight: 600; color: rgba(255,255,255,.55); }
.pac-qr-issued { font-size: 11px; color: rgba(255,255,255,.35); }
.pac-qr-valid  { font-size: 11px; color: #34d399; }

/* ── card footer ── */
.pac-card-footer {
  padding: 12px 22px;
  background: rgba(0,0,0,.25);
  border-top: 1px solid rgba(255,255,255,.05);
  display: flex; flex-direction: column; gap: 4px;
}
.pac-footer-note       { font-size: 11px; color: #fbbf24; }
.pac-footer-watermark  { font-size: 10px; color: rgba(255,255,255,.2); letter-spacing: .06em; text-transform: uppercase; }

/* ══ ACTION BUTTONS ══ */
.pac-actions {
  display: grid; grid-template-columns: 1fr 1fr 1fr 1fr;
  gap: 10px;
}
.pac-btn {
  display: flex; align-items: center; justify-content: center; gap: 7px;
  padding: 11px 14px; border-radius: 11px;
  font-size: 13px; font-weight: 600; cursor: pointer;
  border: 1.5px solid transparent; transition: all .2s;
  font-family: 'Inter', sans-serif;
}
.pac-btn--print { background: rgba(255,255,255,.1); border-color: rgba(255,255,255,.18); color: #fff; }
.pac-btn--print:hover { background: rgba(255,255,255,.18); }
.pac-btn--copy  { background: rgba(20,184,166,.15); border-color: rgba(20,184,166,.3); color: #5eead4; }
.pac-btn--copy:hover { background: rgba(20,184,166,.25); }
.pac-btn--new   { background: rgba(99,102,241,.15); border-color: rgba(99,102,241,.3); color: #a5b4fc; }
.pac-btn--new:hover { background: rgba(99,102,241,.25); }
.pac-btn--done  { background: linear-gradient(135deg, #14b8a6, #0d9488); color: #fff; box-shadow: 0 4px 14px rgba(13,148,136,.4); }
.pac-btn--done:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(13,148,136,.5); }

.pac-print-tip {
  text-align: center; font-size: 12px;
  color: rgba(255,255,255,.35); margin-top: -4px;
}

/* ══ TRANSITIONS ══ */
.card-pop-enter-active { animation: overlayIn .3s ease both; }
.card-pop-leave-active { animation: overlayOut .25s ease both; }
@keyframes overlayIn  { from { opacity: 0; } to { opacity: 1; } }
@keyframes overlayOut { to   { opacity: 0; } }
@keyframes cardIn     { from { opacity: 0; transform: translateY(20px) scale(.97); } to { opacity: 1; transform: none; } }
@keyframes bannerIn   { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: none; } }

/* ══ RESPONSIVE ══ */
@media (max-width: 600px) {
  .pac-code-chunk { font-size: 17px; padding: 5px 9px; }
  .pac-patient-name { font-size: 18px; }
  .pac-actions { grid-template-columns: 1fr 1fr; }
  .pac-pin-box { width: 28px; height: 36px; font-size: 15px; }
}

@media print {
  .pac-overlay, .pac-x, .pac-success-banner,
  .pac-actions, .pac-print-tip { display: none !important; }
  .pac-card { box-shadow: none; }
}
</style>
