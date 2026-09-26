<template>
  <div class="auth-page">
    <!-- auth-surface keeps the global dark remap from repainting this card's
         fields; see the block of the same name in assets/styles.css. -->
    <div class="auth-card auth-surface">
      <div class="auth-head">
        <h2>Reset your password</h2>
        <p class="subtitle">Enter the email address you sign in with and we will send you a reset link.</p>
      </div>

      <form v-if="!submitted" @submit.prevent="submit" novalidate>
        <div class="form-group" :class="{ 'has-error': touched && !email.trim() }">
          <label for="reset-email">Email Address</label>
          <input id="reset-email" type="email" v-model="email" placeholder="Enter your email" @blur="touched = true" />
          <span class="field-error" v-if="touched && !email.trim()">Email is required</span>
        </div>

        <button type="submit" class="btn btn-primary btn-block" :disabled="loading">
          <span v-if="loading" class="btn-spinner"></span>
          {{ loading ? 'Sending...' : 'Send reset link' }}
        </button>
      </form>

      <!-- The same wording whether or not the account exists, so this screen
           cannot be used to discover which staff addresses are registered. -->
      <div v-else class="notice" role="status">
        <p>{{ message }}</p>
        <p class="muted">If it does not arrive, check the spam folder, or ask an administrator to reset it for you.</p>
      </div>

      <div class="auth-foot">
        <router-link to="/login">Back to sign in</router-link>
      </div>
    </div>
  </div>
</template>

<script>
import { ref } from 'vue'
import axios from 'axios'
import { useToast } from '../../store/toast'

export default {
  name: 'ForgotPassword',
  setup() {
    const toast = useToast()
    const email = ref('')
    const loading = ref(false)
    const touched = ref(false)
    const submitted = ref(false)
    const message = ref('')

    const submit = async () => {
      touched.value = true
      if (!email.value.trim()) return
      loading.value = true
      try {
        const { data } = await axios.post('/api/auth/forgot-password', { email: email.value.trim() })
        message.value = data.message
        submitted.value = true
      } catch (e) {
        toast.error(e.response?.data?.message || 'Could not send the reset link. Please try again.')
      } finally {
        loading.value = false
      }
    }

    return { email, loading, touched, submitted, message, submit }
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
  max-width: 420px;
  background: #fff;
  border-radius: 16px;
  padding: 36px 32px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, .35);
}
.auth-head { margin-bottom: 24px; }
.auth-head h2 { font-size: 22px; color: var(--text-primary); margin-bottom: 6px; }
.subtitle { color: var(--text-muted); font-size: 14px; margin: 0; }
.btn-block { width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; }
.btn-spinner {
  width: 16px; height: 16px; border: 2px solid rgba(255,255,255,.3);
  border-top-color: #fff; border-radius: 50%; animation: spin .8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.has-error input { border-color: var(--danger); }
.field-error { font-size: 12px; color: var(--danger-fg); margin-top: 4px; display: block; }
.notice {
  background: #f0fdfa;
  border: 1px solid #99f6e4;
  border-left: 4px solid #0d9488;
  border-radius: 6px;
  padding: 14px 16px;
  font-size: 14px;
  color: var(--primary);
  line-height: 1.5;
}
.notice p { margin: 0 0 8px; }
.notice p:last-child { margin-bottom: 0; }
.muted { color: var(--primary); font-size: 13px; }
.auth-foot { margin-top: 22px; text-align: center; font-size: 13px; }
.auth-foot a { color: var(--primary); text-decoration: none; font-weight: 500; }
.auth-foot a:hover { text-decoration: underline; }
</style>
