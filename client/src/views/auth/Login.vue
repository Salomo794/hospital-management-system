<template>
  <div class="login-page">
    <div class="bg-grid" aria-hidden="true"></div>
    <div class="bg-glow bg-glow-a" aria-hidden="true"></div>
    <div class="bg-glow bg-glow-b" aria-hidden="true"></div>

    <div class="login-container">
      <div class="login-left">
        <div class="login-pattern" aria-hidden="true"></div>
        <div class="login-brand">
          <div class="brand-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M12 3v18M3 12h18" />
            </svg>
          </div>
          <h1>MediCare</h1>
          <p class="brand-tagline">Hospital Management System</p>
        </div>

        <p class="hero-copy">
          One secure platform connecting every department — from admissions to analytics.
        </p>

        <div class="login-features">
          <div class="feature">
            <span class="feature-dot"></span>
            Digital Patient Records
          </div>
          <div class="feature">
            <span class="feature-dot"></span>
            Smart Scheduling
          </div>
          <div class="feature">
            <span class="feature-dot"></span>
            Pharmacy Management
          </div>
          <div class="feature">
            <span class="feature-dot"></span>
            AI-Powered Assistant
          </div>
          <div class="feature">
            <span class="feature-dot"></span>
            Real-time Analytics
          </div>
        </div>

        <div class="login-footer">
          <span class="status-pill">
            <i class="status-dot"></i>
            System Online
          </span>
          <span class="foot-note">&copy; 2026 MediCare</span>
        </div>
        <div class="login-footnote">
          <span class="foot-dot"></span>
          Role-based access &middot; Authenticated sessions
        </div>
      </div>

      <div class="login-right">
        <form @submit.prevent="handleLogin" class="login-form" novalidate>
          <div class="form-heading">
            <span class="form-eyebrow">Secure Access</span>
            <h2>Welcome Back</h2>
            <p class="subtitle">Sign in to your account to continue</p>
          </div>

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
            <p class="demo-title">Quick demo access</p>
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
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(150deg, #042f2e 0%, #0f4c5c 55%, #134e4a 100%);
  padding: 20px;
  position: relative;
  overflow: hidden;
}

.bg-grid {
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(circle at 1px 1px, rgba(255, 255, 255, 0.06) 1px, transparent 0);
  background-size: 34px 34px;
  mask-image: radial-gradient(ellipse at 30% 40%, black, transparent 70%);
}

.bg-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  opacity: 0.35;
  pointer-events: none;
}

.bg-glow-a {
  width: 420px;
  height: 420px;
  background: #14b8a6;
  top: -120px;
  right: -80px;
}

.bg-glow-b {
  width: 380px;
  height: 380px;
  background: #0ea5e9;
  bottom: -140px;
  left: -90px;
}

.login-container {
  position: relative;
  display: flex;
  max-width: 960px;
  width: 100%;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 22px;
  overflow: hidden;
  box-shadow: 0 30px 80px rgba(2, 20, 25, 0.55);
  backdrop-filter: blur(14px);
}

.login-left {
  flex: 1;
  background: linear-gradient(160deg, rgba(20, 184, 166, 0.16) 0%, transparent 100%);
  color: white;
  padding: 46px 40px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.brand-badge {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #14b8a6, #0ea5e9);
  box-shadow: 0 10px 25px rgba(20, 184, 166, 0.45);
  margin-bottom: 20px;
}

.brand-badge svg {
  width: 30px;
  height: 30px;
}

.login-brand h1 {
  font-size: 32px;
  font-weight: 800;
  letter-spacing: -0.5px;
  margin-bottom: 4px;
}

.brand-tagline {
  opacity: 0.75;
  font-size: 14px;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.hero-copy {
  margin-top: 22px;
  font-size: 14px;
  line-height: 1.7;
  opacity: 0.85;
  max-width: 320px;
}

.login-features {
  margin-top: 30px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.feature {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  font-size: 14px;
  opacity: 0.92;
}

.feature-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #5eead4;
  box-shadow: 0 0 0 4px rgba(94, 234, 212, 0.15);
}

.login-footer {
  margin-top: 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.15);
  font-size: 12px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #34d399;
  animation: pulse 1.8s ease-in-out infinite;
}

.foot-note {
  font-size: 12px;
  opacity: 0.5;
}

.login-right {
  flex: 1;
  padding: 44px 40px;
  background: var(--surface);
}

.form-heading {
  margin-bottom: 24px;
}

.form-eyebrow {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: #0d9488;
  background: #f0fdfa;
  border: 1px solid #99f6e4;
  border-radius: 999px;
  padding: 4px 10px;
  margin-bottom: 12px;
}

.login-form h2 {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.subtitle {
  color: var(--text-muted);
  font-size: 14px;
}

.form-group {
  margin-bottom: 18px;
}

.form-group label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.form-group input {
  width: 100%;
  padding: 12px 14px;
  border: 1.5px solid #e2e8f0;
  border-radius: 10px;
  font-size: 14px;
  color: var(--text-primary);
  background: var(--bg-app);
  transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
}

.form-group input:focus {
  outline: none;
  border-color: #0d9488;
  background: var(--surface);
  box-shadow: 0 0 0 4px rgba(13, 148, 136, 0.12);
}

.btn-block {
  width: 100%;
  padding: 13px;
  font-size: 15px;
  font-weight: 600;
  border-radius: 10px;
}

.btn-primary {
  background: linear-gradient(135deg, #0d9488, #0f766e);
  border: none;
  box-shadow: 0 10px 20px rgba(13, 148, 136, 0.3);
  transition: transform 0.2s, box-shadow 0.2s;
}

.btn-primary:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 14px 26px rgba(13, 148, 136, 0.4);
}

.btn-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.has-error input {
  border-color: var(--danger);
}

.field-error {
  font-size: 12px;
  color: var(--danger);
  margin-top: 5px;
  display: block;
}

.demo-accounts {
  margin-top: 26px;
  padding-top: 18px;
  border-top: 1px solid #e2e8f0;
}

.demo-title {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 10px;
}

.demo-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.demo-btn {
  padding: 5px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  background: var(--bg-app);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.demo-btn:hover {
  background: #0d9488;
  color: white;
  border-color: #0d9488;
}

.demo-note {
  font-size: 11px;
  color: var(--text-subtle);
  margin-top: 10px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(0.7);
  }
}

@media (max-width: 768px) {
  .login-container {
    flex-direction: column;
  }
  .login-left {
    padding: 28px 24px;
  }
  .login-right {
    padding: 30px 24px;
  }
  .login-footer {
    margin-top: 24px;
  }
}

@media (max-width: 576px) {
  .login-page {
    padding: 12px;
  }
  .login-left {
    padding: 22px 18px;
    display: block;
  }
  .login-right {
    padding: 24px 18px;
  }
  .login-features {
    margin-top: 20px;
  }
  .feature {
    font-size: 13px;
  }
  .brand-badge {
    width: 46px;
    height: 46px;
    margin-bottom: 16px;
  }
  .login-brand h1 {
    font-size: 26px;
  }
  .hero-copy {
    font-size: 13px;
  }
}
</style>
