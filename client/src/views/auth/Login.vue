<template>
  <div class="login-page">
    <div class="login-container">
      <div class="login-left">
        <div class="login-pattern" aria-hidden="true"></div>
        <div class="login-brand">
          <div class="brand-icon" v-html="brandIcon"></div>
          <h1>MediCare</h1>
          <p>Hospital Management System</p>
        </div>
        <div class="login-features">
          <div class="feature"><span>&#10003;</span> Digital Patient Records</div>
          <div class="feature"><span>&#10003;</span> Smart Scheduling</div>
          <div class="feature"><span>&#10003;</span> Pharmacy Management</div>
          <div class="feature"><span>&#10003;</span> AI-Powered Assistant</div>
          <div class="feature"><span>&#10003;</span> Real-time Analytics</div>
        </div>
        <div class="login-footnote">
          <span class="foot-dot"></span>
          Role-based access &middot; Authenticated sessions
        </div>
      </div>
      <!-- auth-surface keeps the global dark remap from repainting this panel's
           fields; see the block of the same name in assets/styles.css. -->
      <div class="login-right auth-surface">
        <form @submit.prevent="handleLogin" class="login-form" novalidate>
          <h2>Welcome Back</h2>
          <p class="subtitle">Sign in to your account</p>

          <div class="form-group" :class="{ 'has-error': emailTouched && !email.trim() }">
            <label>Email Address</label>
            <input
              type="email" v-model="email" placeholder="Enter your email"
              @blur="emailTouched = true"
            />
            <span class="field-error" v-if="emailTouched && !email.trim()">Email is required</span>
          </div>

          <div class="form-group" :class="{ 'has-error': passwordTouched && !password }">
            <label>Password</label>
            <div class="input-wrap">
              <input
                :type="showPassword ? 'text' : 'password'"
                v-model="password" placeholder="Enter your password"
                @blur="passwordTouched = true"
              />
              <button
                type="button" class="reveal"
                @click="showPassword = !showPassword"
                :aria-label="showPassword ? 'Hide password' : 'Show password'"
                :title="showPassword ? 'Hide password' : 'Show password'"
              >
                <span v-html="showPassword ? eyeOffIcon : eyeIcon"></span>
              </button>
            </div>
            <span class="field-error" v-if="passwordTouched && !password">Password is required</span>
          </div>

          <button type="submit" class="btn btn-primary btn-block" :disabled="loading">
            <span v-if="loading" class="btn-spinner"></span>
            {{ loading ? 'Signing in...' : 'Sign In' }}
          </button>

          <div class="form-links">
            <router-link to="/forgot-password">Forgot password?</router-link>
          </div>

          <div class="demo-accounts">
            <p>Demo Accounts:</p>
            <div class="demo-list">
              <button type="button" class="demo-btn" @click="fillDemo('admin@hospital.com')">Admin</button>
              <button type="button" class="demo-btn" @click="fillDemo('doctor@hospital.com')">Doctor</button>
              <button type="button" class="demo-btn" @click="fillDemo('nurse@hospital.com')">Nurse</button>
              <button type="button" class="demo-btn" @click="fillDemo('receptionist@hospital.com')">Receptionist</button>
              <button type="button" class="demo-btn" @click="fillDemo('pharmacist@hospital.com')">Pharmacist</button>
              <button type="button" class="demo-btn" @click="fillDemo('labtech@hospital.com')">Lab Tech</button>
            </div>
            <p class="demo-note">Password: password123</p>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../../store/auth'
import { useToast } from '../../store/toast'

const svg = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`

const brandIcon = svg('<path d="M12 6.5v11M6.5 12h11"/>')
const eyeIcon = svg('<path d="M2.2 12S5.6 5.5 12 5.5 21.8 12 21.8 12 18.4 18.5 12 18.5 2.2 12 2.2 12Z"/><circle cx="12" cy="12" r="3.1"/>')
const eyeOffIcon = svg('<path d="M9.9 5.7A9.6 9.6 0 0 1 12 5.5c6.4 0 9.8 6.5 9.8 6.5a17.6 17.6 0 0 1-3.4 4.2"/><path d="M6.4 7.4A17.4 17.4 0 0 0 2.2 12S5.6 18.5 12 18.5a9.7 9.7 0 0 0 4.2-.9"/><path d="M9.9 9.9a3.1 3.1 0 0 0 4.3 4.3"/><path d="M3 3l18 18"/>')

export default {
  name: 'Login',
  setup() {
    const router = useRouter()
    const route = useRoute()
    const authStore = useAuthStore()
    const toast = useToast()
    const email = ref('')
    const password = ref('')
    const loading = ref(false)
    const emailTouched = ref(false)
    const passwordTouched = ref(false)
    const showPassword = ref(false)

    const handleLogin = async () => {
      emailTouched.value = true
      passwordTouched.value = true

      if (!email.value.trim() || !password.value) {
        toast.warning('Please fill in all fields.')
        return
      }

      loading.value = true
      try {
        await authStore.login(email.value, password.value)
        toast.success('Login successful!')
        const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
          ? route.query.redirect
          : '/dashboard'
        router.push(redirect)
      } catch (e) {
        toast.error(e.response?.data?.message || 'Login failed. Please check your credentials.')
      } finally {
        loading.value = false
      }
    }

    const fillDemo = (emailAddr) => {
      email.value = emailAddr
      password.value = 'password123'
      emailTouched.value = false
      passwordTouched.value = false
    }

    return {
      email, password, loading, emailTouched, passwordTouched, showPassword,
      handleLogin, fillDemo, brandIcon, eyeIcon, eyeOffIcon
    }
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex; align-items: center; justify-content: center;
  padding: 20px;
  position: relative;
  overflow: hidden;

  /* Rich animated mesh gradient */
  background:
    radial-gradient(ellipse 80% 60% at 10% 20%, #0d9488 0%, transparent 60%),
    radial-gradient(ellipse 70% 70% at 90% 80%, #0f4c5c 0%, transparent 55%),
    radial-gradient(ellipse 60% 50% at 50% 50%, #0c2340 0%, transparent 70%),
    linear-gradient(135deg, #071e2b 0%, #0d2d3a 50%, #071520 100%);
  background-attachment: fixed;
}

/* Floating blobs behind the card */
.login-page::before,
.login-page::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
  pointer-events: none;
  animation: blobFloat 12s ease-in-out infinite alternate;
}
.login-page::before {
  width: 560px; height: 560px;
  background: radial-gradient(circle, rgba(13,148,136,.45) 0%, transparent 70%);
  top: -160px; left: -120px;
}
.login-page::after {
  width: 480px; height: 480px;
  background: radial-gradient(circle, rgba(20,40,90,.55) 0%, transparent 70%);
  bottom: -140px; right: -100px;
  animation-delay: -6s;
}
@keyframes blobFloat {
  0%   { transform: translate(0,0) scale(1); }
  50%  { transform: translate(30px,20px) scale(1.08); }
  100% { transform: translate(-20px,10px) scale(.95); }
}

.login-container {
  position: relative; z-index: 1;
  display: flex; max-width: 920px; width: 100%;
  border-radius: 20px; overflow: hidden;
  box-shadow:
    0 0 0 1px rgba(255,255,255,.08),
    0 30px 80px rgba(0,0,0,.55),
    0 8px 24px rgba(0,0,0,.3);
}
.login-left {
  flex: 1;
  background: linear-gradient(155deg, #0d9488 0%, #0b6e65 40%, #083d4a 100%);
  color: white; padding: 44px; display: flex; flex-direction: column;
  justify-content: center; position: relative; overflow: hidden;
}
.login-pattern {
  position: absolute; inset: 0; pointer-events: none;
  background-image:
    /* big soft glow top-right */
    radial-gradient(ellipse 70% 55% at 85% 8%, rgba(94,234,212,.22) 0%, transparent 65%),
    /* smaller glow bottom-left */
    radial-gradient(ellipse 50% 45% at 8% 92%, rgba(45,212,191,.18) 0%, transparent 60%),
    /* fine dot grid */
    radial-gradient(rgba(255,255,255,.12) 1px, transparent 1px);
  background-size: auto, auto, 28px 28px;
}

/* Decorative rings */
.login-left::before,
.login-left::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,.1);
  pointer-events: none;
}
.login-left::before {
  width: 340px; height: 340px;
  top: -120px; right: -80px;
  box-shadow: inset 0 0 60px rgba(255,255,255,.04);
}
.login-left::after {
  width: 200px; height: 200px;
  bottom: -60px; left: -40px;
  border-color: rgba(255,255,255,.07);
}
.login-left > *:not(.login-pattern) { position: relative; z-index: 1; }
.brand-icon {
  width: 54px; height: 54px; border-radius: 15px;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.22);
  display: grid; place-items: center; margin-bottom: 18px;
}
.brand-icon :deep(svg) { width: 28px; height: 28px; stroke-width: 2.4; color: #75e0cf; }
.login-brand h1 { font-size: 30px; font-weight: 700; margin-bottom: 4px; letter-spacing: -0.02em; }
.login-brand p { opacity: 0.8; font-size: 14px; }
.login-features { margin-top: 38px; }
.login-footnote {
  margin-top: auto; padding-top: 32px;
  display: flex; align-items: center; gap: 9px;
  font-size: 11.5px; letter-spacing: 0.04em;
  color: rgba(255, 255, 255, 0.62);
}
.foot-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #75e0cf; box-shadow: 0 0 0 4px rgba(117, 224, 207, 0.18);
}
.feature {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 0; font-size: 14px; opacity: 0.9;
}
.feature span { color: #5eead4; font-size: 16px; }
.login-right {
  flex: 1; padding: 44px;
  background: rgba(255,255,255,.97);
  backdrop-filter: blur(20px);
}
.login-form h2 { font-size: 24px; color: #1e293b; margin-bottom: 4px; }
.subtitle { color: #64748b; margin-bottom: 24px; font-size: 14px; }
.btn-block { width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; }
.input-wrap { position: relative; display: flex; align-items: center; }
.input-wrap input { padding-right: 44px; }
.reveal {
  position: absolute; right: 8px;
  display: flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; padding: 0;
  background: none; border: none; border-radius: 7px;
  color: #94a3b8; cursor: pointer;
  transition: color 0.2s, background 0.2s;
}
.reveal:hover { color: #0d9488; background: #f0fdfa; }
.reveal :deep(svg) { width: 17px; height: 17px; }
.btn-spinner {
  width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3);
  border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite;
}
.has-error input { border-color: #ef4444; }
.field-error { font-size: 12px; color: #ef4444; margin-top: 4px; display: block; }
.form-links {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
  font-size: 13px;
}
.form-links a {
  color: #0d9488;
  text-decoration: none;
  font-weight: 500;
}
.form-links a:hover { text-decoration: underline; }
.form-links a:focus-visible { outline: 2px solid #0d9488; outline-offset: 2px; border-radius: 4px; }
.demo-accounts { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; }
.demo-accounts p { font-size: 12px; color: #64748b; margin-bottom: 8px; }
.demo-list { display: flex; flex-wrap: wrap; gap: 6px; }
.demo-btn {
  padding: 4px 10px; border: 1px solid #e2e8f0; border-radius: 6px;
  background: #f8fafc; font-size: 11px; cursor: pointer; transition: all 0.2s;
}
.demo-btn:hover { background: #0d9488; color: white; border-color: #0d9488; }
.demo-note { font-size: 11px; color: #94a3b8; margin-top: 8px; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 768px) {
  .login-container { flex-direction: column; }
  .login-left { padding: 30px 24px; min-height: auto; }
  .login-left::before { width: 200px; height: 200px; top: -80px; right: -50px; }
  .login-left::after  { width: 130px; height: 130px; bottom: -40px; left: -30px; }
  .login-right { padding: 28px; }
}

@media (max-width: 576px) {
  .login-page { padding: 12px; }
  .login-left { padding: 24px 20px; }
  .login-right { padding: 20px; }
  .login-features { margin-top: 22px; }
  .feature { font-size: 13px; }
  .brand-icon { width: 46px; height: 46px; border-radius: 13px; margin-bottom: 14px; }
  .brand-icon :deep(svg) { width: 24px; height: 24px; }
  .login-brand h1 { font-size: 25px; }
  .login-footnote { padding-top: 22px; }
}
</style>
