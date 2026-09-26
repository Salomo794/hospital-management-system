<template>
  <div class="auth-page">
    <!-- auth-surface keeps the global dark remap from repainting this card's
         fields; see the block of the same name in assets/styles.css. -->
    <div class="auth-card auth-surface">
      <div class="auth-head">
        <h2>Choose a new password</h2>
        <p class="subtitle" v-if="!expired">Pick something you have not used before. You will be signed out everywhere else.</p>
        <p class="subtitle" v-else>Enter your new password to finish.</p>
      </div>

      <!-- Shown when the link is spent or out of date, rather than letting the
           user type a new password only to be rejected on submit. -->
      <div v-if="tokenError" class="notice error" role="alert">
        <p>{{ tokenError }}</p>
        <router-link to="/forgot-password">Request a new link</router-link>
      </div>

      <form v-else @submit.prevent="submit" novalidate>
        <div class="form-group">
          <label for="new-password">New Password</label>
          <div class="input-wrap">
            <input
              id="new-password" :type="show ? 'text' : 'password'"
              v-model="password" :placeholder="`At least ${PASSWORD_MIN_LENGTH} characters`" @input="touched = true"
              :minlength="PASSWORD_MIN_LENGTH" :maxlength="PASSWORD_MAX_LENGTH"
              autocomplete="new-password" aria-describedby="new-password-help"
            />
            <button type="button" class="reveal" @click="show = !show" :aria-label="show ? 'Hide password' : 'Show password'">
              <span v-html="show ? eyeOffIcon : eyeIcon"></span>
            </button>
          </div>
          <div class="strength-meter" id="new-password-help">
            <div class="strength-bar"><span :class="strengthClass" :style="{ width: strengthPercent }" /></div>
            <span class="strength-label">{{ strengthLabel }}</span>
          </div>
        </div>

        <div class="form-group">
          <label for="confirm-password">Confirm New Password</label>
          <input
            id="confirm-password" :type="show ? 'text' : 'password'"
            v-model="confirm" placeholder="Type it again" @input="touched = true"
            autocomplete="new-password"
          />
          <span class="field-error" v-if="touched && mismatch">Passwords do not match</span>
        </div>

        <!-- The same policy module the change-password and create-user forms use,
             so all three behave identically. The server still re-checks every rule
             and has the final say. -->
        <ul class="policy-list" v-if="passwordProblems.length">
          <li v-for="problem in passwordProblems" :key="problem">{{ problem }}</li>
        </ul>

        <div class="notice error" v-if="serverError" role="alert">{{ serverError }}</div>

        <button type="submit" class="btn btn-primary btn-block" :disabled="loading || !canSubmit">
          <span v-if="loading" class="btn-spinner"></span>
          {{ loading ? 'Saving...' : 'Set new password' }}
        </button>
      </form>

      <div class="auth-foot">
        <router-link to="/login">Back to sign in</router-link>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { useToast } from '../../store/toast'
import {
  validatePassword, passwordStrength, MIN_LENGTH as PASSWORD_MIN_LENGTH, MAX_LENGTH as PASSWORD_MAX_LENGTH
} from '../../utils/passwordPolicy'

const svg = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
const eyeIcon = svg('<path d="M2.2 12S5.6 5.5 12 5.5 21.8 12 21.8 12 18.4 18.5 12 18.5 2.2 12 2.2 12Z"/><circle cx="12" cy="12" r="3.1"/>')
const eyeOffIcon = svg('<path d="M9.9 5.7A9.6 9.6 0 0 1 12 5.5c6.4 0 9.8 6.5 9.8 6.5a17.6 17.6 0 0 1-3.4 4.2"/><path d="M6.4 7.4A17.4 17.4 0 0 0 2.2 12S5.6 18.5 12 18.5a9.7 9.7 0 0 0 4.2-.9"/><path d="M9.9 9.9a3.1 3.1 0 0 0 4.3 4.3"/><path d="M3 3l18 18"/>')

export default {
  name: 'ResetPassword',
  setup() {
    const route = useRoute()
    const router = useRouter()
    const toast = useToast()
    const password = ref('')
    const confirm = ref('')
    const show = ref(false)
    const loading = ref(false)
    const touched = ref(false)
    const tokenError = ref('')
    const serverError = ref('')
    const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))

    const mismatch = computed(() => confirm.value.length > 0 && confirm.value !== password.value)
    // No name or email context is passed: nobody is signed in here, so the form
    // cannot know them. The server checks those two rules against the real
    // account when the token is redeemed.
    const passwordProblems = computed(
      () => (password.value ? validatePassword(password.value) : [])
    )
    const strength = computed(() => passwordStrength(password.value))
    const strengthLabel = computed(() => strength.value.label)
    const strengthClass = computed(() => `strength-${strength.value.score}`)
    const strengthPercent = computed(() => `${(strength.value.score / 4) * 100}%`)
    const canSubmit = computed(
      () => password.value.length > 0 && passwordProblems.value.length === 0 && confirm.value.length > 0 && !mismatch.value
    )

    // Checked up front so an expired or already-used link is explained before
    // the user types anything, and the form is not shown in a state that cannot
    // possibly succeed.
    onMounted(async () => {
      if (!token.value) {
        tokenError.value = 'This password reset link is missing its token. Please request a new one.'
        return
      }
      try {
        await axios.get(`/api/auth/reset-password/${encodeURIComponent(token.value)}`)
      } catch (e) {
        tokenError.value = e.response?.data?.message || 'This password reset link is not valid.'
      }
    })

    const submit = async () => {
      touched.value = true
      serverError.value = ''
      if (!canSubmit.value) return
      loading.value = true
      try {
        const { data } = await axios.post('/api/auth/reset-password', {
          token: token.value,
          newPassword: password.value
        })
        toast.success(data.message || 'Password reset. Please sign in.')
        router.push('/login')
      } catch (e) {
        // A spent link is the most likely failure here, and it needs a way out
        // rather than a retry that will keep failing.
        const message = e.response?.data?.message || 'Could not reset your password.'
        serverError.value = message
        if (e.response?.status === 400) tokenError.value = message
      } finally {
        loading.value = false
      }
    }

    return {
      password, confirm, show, loading, touched, tokenError, serverError,
      mismatch, passwordProblems, canSubmit, submit, eyeIcon, eyeOffIcon,
      strengthLabel, strengthClass, strengthPercent,
      PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH,
    }
  }
}
</script>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: linear-gradient(135deg, #071e2b 0%, #0d2d3a 50%, #071520 100%);
}
.auth-card {
  width: 100%;
  max-width: 440px;
  background: #fff;
  border-radius: 16px;
  padding: 36px 32px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, .35);
}
.auth-head { margin-bottom: 22px; }
.auth-head h2 { font-size: 22px; color: #1e293b; margin-bottom: 6px; }
.subtitle { color: #64748b; font-size: 14px; margin: 0; }
.input-wrap { position: relative; display: flex; align-items: center; }
.input-wrap input { padding-right: 44px; }
.reveal {
  position: absolute; right: 8px;
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; padding: 0;
  background: none; border: none; border-radius: 7px;
  color: #94a3b8; cursor: pointer;
}
.reveal:hover { color: #0d9488; background: #f0fdfa; }
.reveal :deep(svg) { width: 17px; height: 17px; }
.field-error { font-size: 12px; color: #ef4444; margin-top: 4px; display: block; }
.strength-meter { display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.strength-bar { flex: 1; height: 5px; background: #e2e8f0; border-radius: 3px; overflow: hidden; }
.strength-bar span { display: block; height: 100%; border-radius: 3px; transition: width .2s ease, background .2s ease; }
.strength-0 { background: #dc2626; }
.strength-1 { background: #ea580c; }
.strength-2 { background: #ca8a04; }
.strength-3 { background: #0d9488; }
.strength-4 { background: #15803d; }
.strength-label { font-size: 11px; color: #64748b; min-width: 58px; }
.policy-list {
  list-style: none; padding: 10px 12px; margin: 0 0 16px;
  background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px;
  font-size: 12.5px; color: #991b1b;
}
.policy-list li { margin-bottom: 3px; }
.policy-list li:last-child { margin-bottom: 0; }
.notice {
  border-radius: 6px; padding: 14px 16px; font-size: 14px; line-height: 1.5; margin-bottom: 16px;
}
.notice p { margin: 0 0 8px; }
.notice.error { background: #fef2f2; border: 1px solid #fecaca; border-left: 4px solid #dc2626; color: #991b1b; }
.notice.error a { color: #991b1b; font-weight: 600; }
.btn-block { width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; }
.btn-spinner {
  width: 16px; height: 16px; border: 2px solid rgba(255,255,255,.3);
  border-top-color: #fff; border-radius: 50%; animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.auth-foot { margin-top: 22px; text-align: center; font-size: 13px; }
.auth-foot a { color: #0d9488; text-decoration: none; font-weight: 500; }
.auth-foot a:hover { text-decoration: underline; }
</style>
