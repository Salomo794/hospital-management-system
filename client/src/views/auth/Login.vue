<template>
  <div class="login-page">
    <div class="login-container">
      <div class="login-left">
        <div class="login-brand">
          <div class="brand-icon">&#x2695;</div>
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
      </div>
      <div class="login-right">
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
            <input
              type="password" v-model="password" placeholder="Enter your password"
              @blur="passwordTouched = true"
            />
            <span class="field-error" v-if="passwordTouched && !password">Password is required</span>
          </div>

          <button type="submit" class="btn btn-primary btn-block" :disabled="loading">
            <span v-if="loading" class="btn-spinner"></span>
            {{ loading ? 'Signing in...' : 'Sign In' }}
          </button>

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
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../store/auth'
import { useToast } from '../../store/toast'

export default {
  name: 'Login',
  setup() {
    const router = useRouter()
    const authStore = useAuthStore()
    const toast = useToast()
    const email = ref('')
    const password = ref('')
    const loading = ref(false)
    const emailTouched = ref(false)
    const passwordTouched = ref(false)

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
        router.push('/dashboard')
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

    return { email, password, loading, emailTouched, passwordTouched, handleLogin, fillDemo }
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh; display: flex; align-items: center;
  justify-content: center; background: linear-gradient(135deg, #0d9488 0%, #0f4c5c 100%);
  padding: 20px;
}
.login-container {
  display: flex; max-width: 900px; width: 100%; background: white;
  border-radius: 16px; overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
}
.login-left {
  flex: 1; background: linear-gradient(135deg, #0d9488 0%, #0f4c5c 100%);
  color: white; padding: 40px; display: flex; flex-direction: column;
  justify-content: center;
}
.brand-icon { font-size: 48px; margin-bottom: 16px; }
.login-brand h1 { font-size: 28px; font-weight: 700; margin-bottom: 4px; }
.login-brand p { opacity: 0.8; font-size: 14px; }
.login-features { margin-top: 40px; }
.feature {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 0; font-size: 14px; opacity: 0.9;
}
.feature span { color: #5eead4; font-size: 16px; }
.login-right { flex: 1; padding: 40px; }
.login-form h2 { font-size: 24px; color: #1e293b; margin-bottom: 4px; }
.subtitle { color: #64748b; margin-bottom: 24px; font-size: 14px; }
.btn-block { width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; }
.btn-spinner {
  width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3);
  border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite;
}
.has-error input { border-color: #ef4444; }
.field-error { font-size: 12px; color: #ef4444; margin-top: 4px; display: block; }
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
  .login-left { padding: 24px; }
}
</style>
