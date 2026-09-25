<template>
  <div class="portal-page">
    <header class="portal-header">
      <div>
        <strong>MediCare Patient Portal</strong>
        <span v-if="patient">{{ patient.first_name }} {{ patient.last_name }}</span>
      </div>
      <button v-if="token" class="btn btn-sm btn-outline" @click="logout">Sign out</button>
    </header>

    <main class="portal-shell">
      <section v-if="!token" class="portal-card auth-card">
        <h1>Patient sign in</h1>
        <p>Use the MRN or access code and the 6-digit PIN provided by your care team.</p>
        <form @submit.prevent="login">
          <label>MRN or access code<input v-model.trim="loginForm.identifier" autocomplete="username" required /></label>
          <label>Portal PIN<input v-model="loginForm.portal_pin" type="password" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="current-password" required /></label>
          <div v-if="error" class="error-message">{{ error }}</div>
          <button class="btn btn-primary btn-block" :disabled="loading">{{ loading ? 'Signing in…' : 'Sign in' }}</button>
        </form>
      </section>

      <template v-else>
        <section class="welcome-card">
          <div>
            <span class="eyebrow">Welcome back</span>
            <h1>{{ patient?.first_name }} {{ patient?.last_name }}</h1>
            <p>{{ patient?.mrn }} · {{ patient?.date_of_birth ? formatDate(patient.date_of_birth) : '' }}</p>
          </div>
          <div v-if="checkin" class="queue-card">
            <span>Check-in status</span>
            <strong>{{ formatLabel(checkin.status) }}</strong>
            <small v-if="checkin.status === 'waiting'">{{ aheadInQueue }} patient(s) ahead</small>
          </div>
        </section>

        <nav class="portal-tabs">
          <button v-for="tab in tabs" :key="tab.id" :class="{ active: activeTab === tab.id }" @click="activeTab = tab.id">{{ tab.label }}</button>
        </nav>

        <div v-if="loading" class="loading-state"><div class="spinner" /> Loading your health information…</div>

        <section v-else-if="activeTab === 'appointments'" class="portal-card">
          <h2>Appointments</h2>
          <div v-if="appointments.length" class="record-list">
            <article v-for="item in appointments" :key="item.id" class="record-row">
              <div><strong>{{ formatDate(item.appointment_date) }} at {{ formatTime(item.appointment_time) }}</strong><span>{{ formatLabel(item.type) }} with {{ item.doctor_name }}</span></div>
              <span class="badge" :class="'badge-' + getStatusColor(item.status)">{{ formatLabel(item.status) }}</span>
            </article>
          </div>
          <p v-else class="empty-copy">No appointments are available.</p>
        </section>

        <section v-else-if="activeTab === 'results'" class="portal-card">
          <h2>Lab results</h2>
          <div v-if="labResults.length" class="record-list">
            <article v-for="(item, index) in labResults" :key="`${item.order_number}-${item.test_name}-${index}`" class="record-row">
              <div><strong>{{ item.test_name }}</strong><span>{{ item.result_value }} {{ item.result_unit || '' }} · {{ item.reference_range || 'No range supplied' }}</span></div>
              <span class="badge" :class="item.is_abnormal ? 'badge-danger' : 'badge-success'">{{ item.is_abnormal ? 'Abnormal' : 'Normal' }}</span>
            </article>
          </div>
          <p v-else class="empty-copy">No completed lab results are available.</p>
        </section>

        <section v-else-if="activeTab === 'prescriptions'" class="portal-card">
          <h2>Prescriptions</h2>
          <div v-if="prescriptions.length" class="record-list">
            <article v-for="(item, index) in prescriptions" :key="`${item.prescription_number}-${item.medicine_name}-${index}`" class="record-row">
              <div><strong>{{ item.medicine_name || 'Prescription' }}</strong><span>{{ item.dosage }} · {{ item.frequency }} · Remaining: {{ item.remaining_quantity ?? 0 }}</span></div>
              <span class="badge badge-info">{{ formatLabel(item.status) }}</span>
            </article>
          </div>
          <p v-else class="empty-copy">No prescriptions are available.</p>
        </section>

        <section v-else-if="activeTab === 'bills'" class="portal-card">
          <h2>Bills and payments</h2>
          <div v-if="bills.length" class="record-list">
            <article v-for="bill in bills" :key="bill.id" class="bill-row">
              <div class="bill-summary">
                <strong>{{ bill.bill_number }}</strong>
                <span>Total {{ formatCurrency(bill.net_amount) }} · Paid {{ formatCurrency(bill.paid_amount) }}</span>
              </div>
              <div v-if="outstanding(bill) > 0" class="payment-controls">
                <input v-model.number="paymentAmounts[bill.id]" type="number" min="0.01" :max="outstanding(bill)" step="0.01" aria-label="Payment amount" />
                <button class="btn btn-primary btn-sm" :disabled="payingBillId === bill.id" @click="payBill(bill)">Pay</button>
              </div>
              <span v-else class="badge badge-success">Paid</span>
            </article>
          </div>
          <p v-else class="empty-copy">No bills are available.</p>
          <div v-if="paymentMessage" class="success-message">{{ paymentMessage }}</div>
        </section>
      </template>

      <section class="portal-card kiosk-card">
        <h2>Walk-in check-in</h2>
        <p>Enter the MRN or access code printed on your patient card.</p>
        <form @submit.prevent="checkIn">
          <label>MRN or access code<input v-model.trim="checkinForm.identifier" required /></label>
          <label>Visit purpose<input v-model.trim="checkinForm.purpose" placeholder="Optional" /></label>
          <button class="btn btn-secondary" :disabled="checkingIn">{{ checkingIn ? 'Checking in…' : 'Check in' }}</button>
        </form>
        <div v-if="checkinResult" class="checkin-result">
          <strong>{{ checkinResult.message }}</strong>
          <span v-if="checkinResult.queue_position">Queue position: {{ checkinResult.queue_position }}</span>
        </div>
      </section>
    </main>
  </div>
</template>

<script>
import { computed, onMounted, reactive, ref } from 'vue'
import axios from 'axios'
import { formatCurrency, formatDate, getStatusColor } from '../../utils/helpers'
import { getStoredItem, getStoredJson, removeStoredItem, setStoredItem, setStoredJson } from '../../utils/storage'

export default {
  name: 'PatientPortal',
  setup() {
    const portalApi = axios.create({ baseURL: '/api' })
    const token = ref(getStoredItem('portal-token'))
    const patient = ref(getStoredJson('portal-patient', value => !!value?.id))
    const loginForm = reactive({ identifier: '', portal_pin: '' })
    const checkinForm = reactive({ identifier: '', purpose: '' })
    const activeTab = ref('appointments')
    const loading = ref(false)
    const loggingIn = ref(false)
    const checkingIn = ref(false)
    const payingBillId = ref(null)
    const error = ref('')
    const paymentMessage = ref('')
    const checkinResult = ref(null)
    const checkin = ref(null)
    const aheadInQueue = ref(0)
    const appointments = ref([])
    const labResults = ref([])
    const prescriptions = ref([])
    const bills = ref([])
    const paymentAmounts = reactive({})
    const paymentRequestIds = new Map()
    const tabs = [
      { id: 'appointments', label: 'Appointments' },
      { id: 'results', label: 'Lab Results' },
      { id: 'prescriptions', label: 'Prescriptions' },
      { id: 'bills', label: 'Bills' }
    ]
    const authorization = computed(() => ({ Authorization: `Bearer ${token.value}` }))

    const logout = () => {
      token.value = null
      patient.value = null
      removeStoredItem('portal-token')
      removeStoredItem('portal-patient')
      window.location.assign('/portal')
    }

    const loadPortalData = async () => {
      if (!token.value) return
      loading.value = true
      error.value = ''
      try {
        const [profile, appointmentData, labData, prescriptionData, billData] = await Promise.all([
          portalApi.get('/portal/me', { headers: authorization.value }),
          portalApi.get('/portal/appointments', { headers: authorization.value }),
          portalApi.get('/portal/lab-results', { headers: authorization.value }),
          portalApi.get('/portal/prescriptions', { headers: authorization.value }),
          portalApi.get('/portal/bills', { headers: authorization.value })
        ])
        patient.value = profile.data.patient
        checkin.value = profile.data.checkin
        aheadInQueue.value = profile.data.ahead_in_queue || 0
        appointments.value = appointmentData.data.appointments || []
        labResults.value = labData.data.results || []
        prescriptions.value = prescriptionData.data.prescriptions || []
        bills.value = billData.data.bills || []
        bills.value.forEach(bill => { paymentAmounts[bill.id] = outstanding(bill) })
        setStoredJson('portal-patient', patient.value)
      } catch (requestError) {
        if (requestError.response?.status === 401) logout()
        else error.value = requestError.response?.data?.message || 'Unable to load your portal information.'
      } finally {
        loading.value = false
      }
    }

    const login = async () => {
      loggingIn.value = true
      error.value = ''
      try {
        const { data } = await portalApi.post('/portal/login', loginForm)
        token.value = data.token
        patient.value = data.patient
        setStoredItem('portal-token', data.token)
        setStoredJson('portal-patient', data.patient)
        loginForm.identifier = ''
        loginForm.portal_pin = ''
        checkinForm.identifier = data.patient.mrn
        await loadPortalData()
      } catch (requestError) {
        error.value = requestError.response?.data?.message || 'Invalid patient credentials.'
      } finally {
        loggingIn.value = false
      }
    }

    const checkIn = async () => {
      checkingIn.value = true
      try {
        const { data } = await portalApi.post('/portal/checkin', checkinForm)
        checkinResult.value = data
        if (token.value) await loadPortalData()
      } catch (requestError) {
        checkinResult.value = { message: requestError.response?.data?.message || 'Unable to check in.' }
      } finally {
        checkingIn.value = false
      }
    }

    const outstanding = bill => Math.max(Number(bill.net_amount || 0) - Number(bill.paid_amount || 0), 0)
    const newRequestId = () => globalThis.crypto?.randomUUID?.() || `portal-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const payBill = async bill => {
      const amount = Number(paymentAmounts[bill.id])
      if (!Number.isFinite(amount) || amount <= 0 || amount > outstanding(bill)) {
        paymentMessage.value = 'Enter a positive amount within the outstanding balance.'
        return
      }
      if (!paymentRequestIds.has(bill.id)) paymentRequestIds.set(bill.id, newRequestId())
      payingBillId.value = bill.id
      paymentMessage.value = ''
      try {
        const { data } = await portalApi.post(`/portal/bills/${bill.id}/pay`, {
          amount,
          payment_method: 'card',
          request_id: paymentRequestIds.get(bill.id)
        }, { headers: authorization.value })
        paymentMessage.value = data.message
        paymentRequestIds.delete(bill.id)
        await loadPortalData()
      } catch (requestError) {
        paymentMessage.value = requestError.response?.data?.message || 'Payment could not be recorded.'
      } finally {
        payingBillId.value = null
      }
    }

    const formatTime = value => String(value || '').slice(0, 5)
    const formatLabel = value => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase())

    onMounted(async () => {
      if (patient.value?.mrn) checkinForm.identifier = patient.value.mrn
      if (token.value) await loadPortalData()
    })

    return {
      token, patient, loginForm, checkinForm, activeTab, tabs, loading, loggingIn,
      checkingIn, payingBillId, error, paymentMessage, checkinResult, checkin,
      aheadInQueue, appointments, labResults, prescriptions, bills, paymentAmounts,
      login, logout, loadPortalData, checkIn, payBill, outstanding,
      formatCurrency, formatDate, formatTime, formatLabel, getStatusColor
    }
  }
}
</script>

<style scoped>
.portal-page { min-height: 100vh; background: #f1f5f9; color: #1e293b; }
.portal-header { min-height: 64px; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; background: #0f766e; color: white; }
.portal-header div { display: flex; gap: 18px; align-items: center; }
.portal-header span { color: rgba(255,255,255,.75); font-size: 13px; }
.portal-shell { width: min(100% - 32px, 1000px); margin: 28px auto; display: grid; gap: 18px; }
.portal-card, .welcome-card { background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 24px; box-shadow: 0 8px 24px rgba(15,23,42,.06); }
.auth-card, .kiosk-card { width: min(100%, 520px); justify-self: center; }
h1, h2, p { margin-top: 0; }
form, .payment-controls { display: grid; gap: 14px; }
label { display: grid; gap: 6px; font-size: 13px; font-weight: 600; }
input, select { width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font: inherit; }
.btn-block { width: 100%; }
.welcome-card { display: flex; justify-content: space-between; align-items: center; gap: 20px; }
.eyebrow { color: #0d9488; font-size: 12px; font-weight: 700; text-transform: uppercase; }
.welcome-card h1 { margin: 4px 0; }
.welcome-card p { margin: 0; color: #64748b; }
.queue-card { display: grid; gap: 3px; padding: 14px 18px; border-radius: 10px; background: #ccfbf1; text-align: right; }
.queue-card span, .queue-card small { color: #115e59; font-size: 12px; }
.portal-tabs { display: flex; gap: 8px; flex-wrap: wrap; }
.portal-tabs button { border: 1px solid #cbd5e1; background: white; border-radius: 8px; padding: 9px 14px; cursor: pointer; }
.portal-tabs button.active { background: #0d9488; border-color: #0d9488; color: white; }
.record-list { display: grid; }
.record-row, .bill-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 14px 0; border-bottom: 1px solid #e2e8f0; }
.record-row:last-child, .bill-row:last-child { border-bottom: 0; }
.record-row div, .bill-summary { display: grid; gap: 4px; }
.record-row span, .bill-summary span { color: #64748b; font-size: 13px; }
.payment-controls { grid-template-columns: 130px auto; align-items: center; }
.empty-copy { color: #64748b; padding: 20px 0; }
.error-message, .success-message, .checkin-result { padding: 10px 12px; border-radius: 8px; font-size: 13px; }
.error-message { color: #991b1b; background: #fee2e2; }
.success-message, .checkin-result { color: #115e59; background: #ccfbf1; display: grid; gap: 4px; margin-top: 14px; }
.loading-state { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 50px; color: #64748b; }
.spinner { width: 24px; height: 24px; border: 3px solid #cbd5e1; border-top-color: #0d9488; border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 640px) { .portal-header div { display: grid; gap: 2px; } .welcome-card, .record-row, .bill-row { align-items: flex-start; flex-direction: column; } .payment-controls { width: 100%; } }
</style>
