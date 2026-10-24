<template>
  <section class="security-page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">ACCOUNT SECURITY</p>
        <h1>Security &amp; multi-factor authentication</h1>
        <p class="intro">Protect your staff account with an authenticator app and one-time recovery codes.</p>
      </div>
      <span class="status" :class="mfaEnabled ? 'status--on' : 'status--off'">
        {{ loadingStatus ? 'Checking status…' : (mfaEnabled ? 'MFA enabled' : 'MFA not enabled') }}
      </span>
    </header>

    <div v-if="errorMessage" class="notice notice--error" role="alert">{{ errorMessage }}</div>
    <div v-if="successMessage" class="notice notice--success" role="status">{{ successMessage }}</div>

    <article class="security-card">
      <div class="card-icon" aria-hidden="true">🔐</div>
      <div class="card-copy">
        <h2>Authenticator app</h2>
        <p>
          Use an authenticator app that supports time-based one-time passwords (TOTP).
          Your password remains required; MFA adds a second step during sign-in.
        </p>
      </div>

      <div v-if="!mfaEnabled && !setupInfo" class="actions">
        <button class="primary-button" type="button" :disabled="busy || loadingStatus" @click="startSetup">
          {{ busy ? 'Preparing…' : 'Set up MFA' }}
        </button>
      </div>

      <div v-if="setupInfo && !mfaEnabled" class="setup-panel">
        <h3>1. Add your account to the authenticator app</h3>
        <p>Scan the otpauth URI with a QR scanner that supports authenticator setup, or enter this secret manually.</p>
        <label for="mfa-secret">Setup secret</label>
        <code id="mfa-secret" class="secret">{{ setupInfo.secret }}</code>
        <label for="mfa-uri">Authenticator URI</label>
        <textarea id="mfa-uri" :value="setupInfo.otpauth_url" readonly rows="3" />
        <h3>2. Confirm the setup</h3>
        <p>Enter the current six-digit code shown by your authenticator app.</p>
        <form class="inline-form" @submit.prevent="enableMfa">
          <label for="enable-code">Authenticator code</label>
          <input id="enable-code" v-model="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" required />
          <button class="primary-button" type="submit" :disabled="busy">{{ busy ? 'Verifying…' : 'Enable MFA' }}</button>
        </form>
        <button class="text-button" type="button" :disabled="busy" @click="setupInfo = null">Cancel setup</button>
      </div>

      <div v-if="mfaEnabled" class="enabled-panel">
        <p class="safe-message">MFA is active. New sign-ins require a valid authenticator or unused recovery code.</p>
        <h3>Regenerate recovery codes</h3>
        <p>Generate new codes only if you can provide your password and current authenticator code. Existing recovery codes will stop working.</p>
        <form class="inline-form" @submit.prevent="regenerateCodes">
          <label for="recovery-password">Current password</label>
          <input id="recovery-password" v-model="password" type="password" autocomplete="current-password" required />
          <label for="recovery-totp">Current authenticator code</label>
          <input id="recovery-totp" v-model="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" required />
          <button class="secondary-button" type="submit" :disabled="busy">{{ busy ? 'Generating…' : 'Generate new recovery codes' }}</button>
        </form>
        <div class="danger-zone">
          <h3>Disable MFA</h3>
          <p>Disabling MFA reduces account protection and requires your password and current authenticator code. You will be signed out afterward.</p>
          <form class="inline-form" @submit.prevent="disableMfa">
            <label for="disable-password">Current password</label>
            <input id="disable-password" v-model="disablePassword" type="password" autocomplete="current-password" required />
            <label for="disable-code">Current authenticator code</label>
            <input id="disable-code" v-model="disableCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" required />
            <button class="danger-button" type="submit" :disabled="busy">{{ busy ? 'Updating…' : 'Disable MFA' }}</button>
          </form>
        </div>
      </div>
    </article>

    <article v-if="recoveryCodes.length" class="security-card recovery-card">
      <h2>Save your recovery codes</h2>
      <p>These codes are shown only now. Store them somewhere secure and separate from your password. Each code can be used once.</p>
      <ul class="recovery-list">
        <li v-for="item in recoveryCodes" :key="item"><code>{{ item }}</code></li>
      </ul>
      <button class="primary-button" type="button" @click="recoveryCodes = []">I saved these codes</button>
    </article>

    <article class="security-card">
      <h2>Security reminders</h2>
      <ul class="reminders">
        <li>Never share your password, authenticator code, or recovery codes.</li>
        <li>Enabling or disabling MFA ends other active staff sessions.</li>
        <li>If your authenticator is lost and you have no recovery code, contact an administrator for a verified recovery process.</li>
      </ul>
    </article>
  </section>
</template>

<script>
import { onMounted, ref } from 'vue'
import axios from 'axios'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../store/auth'
import { useToast } from '../../store/toast'

export default {
  name: 'SecuritySettings',
  setup() {
    const router = useRouter()
    const authStore = useAuthStore()
    const toast = useToast()
    const mfaEnabled = ref(false)
    const loadingStatus = ref(true)
    const busy = ref(false)
    const setupInfo = ref(null)
    const code = ref('')
    const password = ref('')
    const disablePassword = ref('')
    const disableCode = ref('')
    const recoveryCodes = ref([])
    const errorMessage = ref('')
    const successMessage = ref('')

    const refreshStatus = async () => {
      loadingStatus.value = true
      try {
        const { data } = await axios.get('/api/auth/me')
        mfaEnabled.value = Boolean(data.mfa_enabled)
        authStore.user = { ...authStore.user, mfa_enabled: mfaEnabled.value }
      } catch (error) {
        errorMessage.value = error.response?.data?.message || 'Could not load account security status.'
      } finally {
        loadingStatus.value = false
      }
    }

    const startSetup = async () => {
      busy.value = true
      errorMessage.value = ''
      successMessage.value = ''
      try {
        const { data } = await axios.post('/api/auth/mfa/setup')
        setupInfo.value = data
      } catch (error) {
        errorMessage.value = error.response?.data?.message || 'Could not start MFA setup.'
      } finally {
        busy.value = false
      }
    }

    const enableMfa = async () => {
      busy.value = true
      errorMessage.value = ''
      successMessage.value = ''
      try {
        const { data } = await axios.post('/api/auth/mfa/enable', { code: code.value.trim() })
        authStore.applySession(data)
        mfaEnabled.value = true
        setupInfo.value = null
        code.value = ''
        recoveryCodes.value = data.recovery_codes || []
        successMessage.value = data.message || 'MFA enabled successfully.'
      } catch (error) {
        errorMessage.value = error.response?.data?.message || 'Could not enable MFA.'
      } finally {
        busy.value = false
      }
    }

    const regenerateCodes = async () => {
      busy.value = true
      errorMessage.value = ''
      successMessage.value = ''
      try {
        const { data } = await axios.post('/api/auth/mfa/recovery-codes/regenerate', {
          password: password.value,
          code: code.value.trim()
        })
        recoveryCodes.value = data.recovery_codes || []
        password.value = ''
        code.value = ''
        successMessage.value = data.message || 'Recovery codes regenerated.'
      } catch (error) {
        errorMessage.value = error.response?.data?.message || 'Could not regenerate recovery codes.'
      } finally {
        busy.value = false
      }
    }

    const disableMfa = async () => {
      busy.value = true
      errorMessage.value = ''
      try {
        await axios.post('/api/auth/mfa/disable', {
          password: disablePassword.value,
          code: disableCode.value.trim()
        })
        authStore.logout()
        toast.success('MFA disabled. Please sign in again.')
        router.replace('/login?session=expired')
      } catch (error) {
        errorMessage.value = error.response?.data?.message || 'Could not disable MFA.'
      } finally {
        busy.value = false
      }
    }

    onMounted(refreshStatus)

    return {
      mfaEnabled, loadingStatus, busy, setupInfo, code, password, disablePassword, disableCode,
      recoveryCodes, errorMessage, successMessage, startSetup, enableMfa, regenerateCodes, disableMfa
    }
  }
}
</script>

<style scoped>
.security-page { max-width: 980px; margin: 0 auto; padding: 28px 24px 48px; color: var(--text-primary, #172033); }
.page-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
.eyebrow { margin: 0 0 8px; font-size: 11px; font-weight: 800; letter-spacing: .12em; color: #54709a; }
h1 { margin: 0; font-size: clamp(24px, 3vw, 32px); line-height: 1.2; }
.intro, .security-card p { color: var(--text-secondary, #64748b); line-height: 1.6; }
.intro { margin: 10px 0 0; }
.status { flex: 0 0 auto; border-radius: 999px; padding: 7px 12px; font-size: 12px; font-weight: 700; }
.status--on { color: #166534; background: #dcfce7; }
.status--off { color: #92400e; background: #fef3c7; }
.security-card { background: var(--surface, #fff); border: 1px solid var(--border, #e2e8f0); border-radius: 16px; padding: 24px; margin: 18px 0; box-shadow: 0 5px 18px rgb(15 23 42 / 4%); }
.card-icon { font-size: 28px; margin-bottom: 10px; }
.security-card h2 { margin: 0 0 10px; font-size: 19px; }
.security-card h3 { margin: 20px 0 8px; font-size: 15px; }
.security-card p { margin: 8px 0 14px; }
.actions { margin-top: 20px; }
.setup-panel, .enabled-panel { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--border, #e2e8f0); }
.setup-panel label, .inline-form label { display: block; margin: 12px 0 6px; font-size: 13px; font-weight: 700; }
.secret, textarea, .inline-form input { width: 100%; box-sizing: border-box; border: 1px solid var(--border, #cbd5e1); border-radius: 9px; padding: 11px 12px; background: var(--input-bg, #fff); color: inherit; }
.secret { display: block; overflow-wrap: anywhere; font-size: 14px; }
textarea { resize: vertical; margin: 4px 0 8px; }
.inline-form { max-width: 480px; }
.inline-form input { min-height: 42px; }
.primary-button, .secondary-button, .danger-button { border: 0; border-radius: 9px; padding: 11px 15px; font-weight: 700; cursor: pointer; margin-top: 12px; }
.primary-button { background: #1768d2; color: #fff; }
.secondary-button { background: #e2e8f0; color: #172033; }
.danger-button { background: #b91c1c; color: #fff; }
button:disabled { opacity: .55; cursor: not-allowed; }
.text-button, .link-button { margin-top: 12px; border: 0; background: transparent; color: #1768d2; cursor: pointer; padding: 8px 0; }
.safe-message { border-left: 3px solid #16a34a; padding-left: 12px; }
.danger-zone { margin-top: 28px; padding-top: 18px; border-top: 1px solid var(--border, #e2e8f0); }
.notice { border-radius: 10px; padding: 12px 14px; margin: 12px 0; line-height: 1.5; }
.notice--error { color: #991b1b; background: #fee2e2; }
.notice--success { color: #166534; background: #dcfce7; }
.recovery-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 8px; list-style: none; padding: 0; margin: 16px 0; }
.recovery-list li { background: var(--surface-muted, #f1f5f9); border-radius: 8px; padding: 10px; text-align: center; }
.reminders { padding-left: 20px; color: var(--text-secondary, #64748b); line-height: 1.8; }
@media (max-width: 640px) { .security-page { padding: 20px 14px 36px; } .page-heading { flex-direction: column; } .security-card { padding: 18px; } }
</style>
