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
          <div v-if="error" class="error-message" role="alert">{{ error }}</div>
          <button class="btn btn-primary btn-block" :disabled="loggingIn">{{ loggingIn ? 'Signing in…' : 'Sign in' }}</button>
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

        <section v-else-if="error" class="portal-card load-error-card" role="alert">
          <h2>Unable to load your information</h2>
          <p aria-live="assertive">{{ error }}</p>
          <button class="btn btn-primary" :disabled="loading" @click="loadPortalData">Retry</button>
        </section>

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
              <div v-if="canPayBill(bill)" class="payment-controls">
                <input v-model.number="paymentAmounts[bill.id]" type="number" min="0.01" :max="outstanding(bill)" step="0.01" :disabled="isPayingBill(bill.id)" aria-label="Payment amount" />
                <button class="btn btn-primary btn-sm" :disabled="isPayingBill(bill.id)" @click="payBill(bill)">
                  {{ isPayingBill(bill.id) ? 'Paying…' : 'Pay' }}
                </button>
              </div>
              <span v-else-if="isBillCancelled(bill)" class="badge badge-gray">Cancelled</span>
              <span v-else-if="!paymentsEnabled && outstanding(bill) > 0" class="badge badge-gray">Payment unavailable</span>
              <span v-else class="badge badge-success">Paid</span>
              <div
                v-if="paymentMessages[bill.id]"
                :class="paymentMessageTypes[bill.id] === 'error' ? 'error-message' : 'success-message'"
                :role="paymentMessageTypes[bill.id] === 'error' ? 'alert' : 'status'"
                :aria-live="paymentMessageTypes[bill.id] === 'error' ? 'assertive' : 'polite'"
              >
                {{ paymentMessages[bill.id] }}
              </div>
            </article>
          </div>
          <p v-else class="empty-copy">No bills are available.</p>
          <p v-if="!paymentsEnabled" class="payment-disabled-note">Online payments are currently unavailable. Please contact reception.</p>
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
        <div v-if="checkinResult" class="checkin-result" role="status" aria-live="polite">
          <strong>{{ checkinResult.message }}</strong>
          <span v-if="checkinResult.queue_position">Queue position: {{ checkinResult.queue_position }}</span>
        </div>
      </section>
    </main>
  </div>
</template>

<script>
import { onMounted, onUnmounted, reactive, ref } from 'vue'
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
    const error = ref('')
    const paymentsEnabled = ref(true)
    const checkinResult = ref(null)
    const checkin = ref(null)
    const aheadInQueue = ref(0)
    const appointments = ref([])
    const labResults = ref([])
    const prescriptions = ref([])
    const bills = ref([])
    const paymentAmounts = reactive({})
    const paymentPending = reactive({})
    const paymentMessages = reactive({})
    const paymentMessageTypes = reactive({})
    const paymentRequestIds = new Map()
    const paymentRefreshState = new Map()
    const paymentControllers = new Map()
    const tabs = [
      { id: 'appointments', label: 'Appointments' },
      { id: 'results', label: 'Lab Results' },
      { id: 'prescriptions', label: 'Prescriptions' },
      { id: 'bills', label: 'Bills' }
    ]

    let sessionGeneration = 0
    let loadGeneration = 0
    let checkinGeneration = 0
    let loadController = null
    let loginController = null
    let checkinController = null
    let componentUnmounted = false

    const requestHeaders = requestToken => ({ Authorization: `Bearer ${requestToken}` })
    const clearObject = target => Object.keys(target).forEach(key => { delete target[key] })

    const clearPortalData = () => {
      patient.value = null
      checkin.value = null
      checkinResult.value = null
      aheadInQueue.value = 0
      appointments.value = []
      labResults.value = []
      prescriptions.value = []
      bills.value = []
      clearObject(paymentAmounts)
      clearObject(paymentPending)
      clearObject(paymentMessages)
      clearObject(paymentMessageTypes)
      paymentRequestIds.clear()
      paymentRefreshState.clear()
      paymentsEnabled.value = true
      error.value = ''
    }

    const abortPortalData = () => {
      loadGeneration += 1
      if (loadController) {
        loadController.abort()
        loadController = null
      }
    }

    const abortPortalRequests = () => {
      abortPortalData()
      checkinGeneration += 1
      if (checkinController) {
        checkinController.abort()
        checkinController = null
      }
      checkingIn.value = false
      paymentControllers.forEach(controller => controller.abort())
      paymentControllers.clear()
      if (loginController) {
        loginController.abort()
        loginController = null
      }
    }

    const invalidatePortalSession = () => {
      sessionGeneration += 1
      abortPortalRequests()
    }

    const outstanding = bill => Math.max(Number(bill.net_amount || 0) - Number(bill.paid_amount || 0), 0)
    const clearConfirmedPaymentKey = billId => {
      const refreshState = paymentRefreshState.get(billId)
      if (!refreshState) return
      const refreshedBill = bills.value.find(candidate => String(candidate.id) === String(billId))
      if (!refreshedBill) return
      const expectedBalance = Math.max(refreshState.previousOutstanding - refreshState.amount, 0)
      if (outstanding(refreshedBill) <= expectedBalance + 0.005) {
        paymentRequestIds.delete(billId)
        paymentRefreshState.delete(billId)
      }
    }
    const isBillCancelled = bill => String(bill.payment_status || '').toLowerCase() === 'cancelled'
    const canPayBill = bill => paymentsEnabled.value && !isBillCancelled(bill) && outstanding(bill) > 0
    const isPayingBill = billId => !!paymentPending[billId]
    const setPaymentMessage = (billId, message, type = 'success') => {
      paymentMessages[billId] = message
      paymentMessageTypes[billId] = type
    }
    const newRequestId = () => globalThis.crypto?.randomUUID?.() || `portal-${Date.now()}-${Math.random().toString(36).slice(2)}`

    const logout = () => {
      invalidatePortalSession()
      token.value = null
      clearPortalData()
      removeStoredItem('portal-token')
      removeStoredItem('portal-patient')
      loginForm.identifier = ''
      loginForm.portal_pin = ''
      checkinForm.identifier = ''
      checkinForm.purpose = ''
      activeTab.value = 'appointments'
      loading.value = false
      loggingIn.value = false
      checkingIn.value = false
      window.location.assign('/portal')
    }

    const loadPortalData = async () => {
      const requestToken = token.value
      if (!requestToken || componentUnmounted) return false

      abortPortalData()
      const requestSession = sessionGeneration
      const requestGeneration = loadGeneration
      const controller = new AbortController()
      loadController = controller
      loading.value = true
      error.value = ''
      const config = () => ({ headers: requestHeaders(requestToken), signal: controller.signal })

      try {
        const [profile, appointmentData, labData, prescriptionData, billData] = await Promise.all([
          portalApi.get('/portal/me', config()),
          portalApi.get('/portal/appointments', config()),
          portalApi.get('/portal/lab-results', config()),
          portalApi.get('/portal/prescriptions', config()),
          portalApi.get('/portal/bills', config())
        ])
        if (
          componentUnmounted ||
          requestSession !== sessionGeneration ||
          requestGeneration !== loadGeneration ||
          controller.signal.aborted ||
          requestToken !== token.value
        ) return

        const profileData = profile.data || {}
        const billPayload = billData.data || {}
        patient.value = profileData.patient
        checkin.value = profileData.checkin
        aheadInQueue.value = profileData.ahead_in_queue || 0
        appointments.value = appointmentData.data?.appointments || []
        labResults.value = labData.data?.results || []
        prescriptions.value = prescriptionData.data?.prescriptions || []
        bills.value = billPayload.bills || []
        if (typeof billPayload.payments_enabled === 'boolean') {
          paymentsEnabled.value = billPayload.payments_enabled
        } else if (typeof profileData.payments_enabled === 'boolean') {
          paymentsEnabled.value = profileData.payments_enabled
        }
        clearObject(paymentAmounts)
        bills.value.forEach(bill => { paymentAmounts[bill.id] = outstanding(bill) })
        paymentRefreshState.forEach((_refreshState, billId) => clearConfirmedPaymentKey(billId))
        setStoredJson('portal-patient', patient.value)
        return true
      } catch (requestError) {
        if (
          componentUnmounted ||
          requestSession !== sessionGeneration ||
          requestGeneration !== loadGeneration ||
          controller.signal.aborted ||
          axios.isCancel(requestError)
        ) return
        if (requestError.response?.status === 401) logout()
        else error.value = requestError.response?.data?.message || 'Unable to load your portal information.'
        return false
      } finally {
        if (
          !componentUnmounted &&
          requestSession === sessionGeneration &&
          requestGeneration === loadGeneration &&
          loadController === controller
        ) {
          loading.value = false
          loadController = null
        }
      }
    }

    const login = async () => {
      invalidatePortalSession()
      clearPortalData()
      token.value = null
      removeStoredItem('portal-token')
      removeStoredItem('portal-patient')
      const requestSession = sessionGeneration
      const controller = new AbortController()
      loginController = controller
      const credentials = { ...loginForm }
      loggingIn.value = true

      try {
        const { data } = await portalApi.post('/portal/login', credentials, { signal: controller.signal })
        if (componentUnmounted || controller.signal.aborted || requestSession !== sessionGeneration) return
        token.value = data.token
        patient.value = data.patient
        if (typeof data.payments_enabled === 'boolean') paymentsEnabled.value = data.payments_enabled
        setStoredItem('portal-token', data.token)
        setStoredJson('portal-patient', data.patient)
        loginForm.identifier = ''
        loginForm.portal_pin = ''
        checkinForm.identifier = data.patient.mrn
        await loadPortalData()
      } catch (requestError) {
        if (componentUnmounted || controller.signal.aborted || requestSession !== sessionGeneration || axios.isCancel(requestError)) return
        error.value = requestError.response?.data?.message || 'Invalid patient credentials.'
      } finally {
        if (loginController === controller) loginController = null
        if (!componentUnmounted && requestSession === sessionGeneration) loggingIn.value = false
      }
    }

    const checkIn = async () => {
      const requestSession = sessionGeneration
      const requestToken = token.value
      const requestGeneration = ++checkinGeneration
      checkinController?.abort()
      const controller = new AbortController()
      checkinController = controller
      checkingIn.value = true
      try {
        const { data } = await portalApi.post('/portal/checkin', { ...checkinForm }, { signal: controller.signal })
        if (
          componentUnmounted ||
          controller.signal.aborted ||
          requestSession !== sessionGeneration ||
          requestGeneration !== checkinGeneration ||
          (requestToken && requestToken !== token.value)
        ) return
        checkinResult.value = data
        if (token.value) await loadPortalData()
      } catch (requestError) {
        if (
          componentUnmounted ||
          controller.signal.aborted ||
          requestSession !== sessionGeneration ||
          requestGeneration !== checkinGeneration ||
          axios.isCancel(requestError)
        ) return
        checkinResult.value = { message: requestError.response?.data?.message || 'Unable to check in.' }
      } finally {
        if (checkinController === controller) checkinController = null
        if (!componentUnmounted && requestSession === sessionGeneration && requestGeneration === checkinGeneration) {
          checkingIn.value = false
        }
      }
    }

    const payBill = async bill => {
      const billId = bill.id
      const requestSession = sessionGeneration
      const requestToken = token.value
      if (!requestToken || paymentPending[billId] || !canPayBill(bill)) return

      const amount = Number(paymentAmounts[billId])
      const previousOutstanding = outstanding(bill)
      if (!Number.isFinite(amount) || amount <= 0 || amount > previousOutstanding) {
        setPaymentMessage(billId, 'Enter a positive amount within the outstanding balance.', 'error')
        return
      }
      if (!paymentRequestIds.has(billId)) paymentRequestIds.set(billId, newRequestId())
      const controller = new AbortController()
      paymentControllers.set(billId, controller)
      paymentPending[billId] = true
      delete paymentMessages[billId]
      delete paymentMessageTypes[billId]

      try {
        const { data } = await portalApi.post(`/portal/bills/${billId}/pay`, {
          amount,
          payment_method: 'card',
          request_id: paymentRequestIds.get(billId)
        }, { headers: requestHeaders(requestToken), signal: controller.signal })
        if (
          componentUnmounted ||
          controller.signal.aborted ||
          requestSession !== sessionGeneration ||
          requestToken !== token.value
        ) return
        setPaymentMessage(billId, data.message || 'Payment recorded successfully.', 'success')
        paymentRefreshState.set(billId, { previousOutstanding, amount })
        await loadPortalData()
      } catch (requestError) {
        if (
          componentUnmounted ||
          controller.signal.aborted ||
          requestSession !== sessionGeneration ||
          requestToken !== token.value ||
          axios.isCancel(requestError)
        ) return
        if (requestError.response?.status === 409) {
          paymentRequestIds.delete(billId)
          paymentRefreshState.delete(billId)
        }
        setPaymentMessage(billId, requestError.response?.data?.message || 'Payment could not be recorded.', 'error')
      } finally {
        if (paymentControllers.get(billId) === controller) paymentControllers.delete(billId)
        if (!componentUnmounted && requestSession === sessionGeneration && requestToken === token.value) {
          paymentPending[billId] = false
        }
      }
    }

    const formatTime = value => String(value || '').slice(0, 5)
    const formatLabel = value => String(value || '').replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase())

    onMounted(async () => {
      if (patient.value?.mrn) checkinForm.identifier = patient.value.mrn
      if (token.value) await loadPortalData()
    })

    onUnmounted(() => {
      componentUnmounted = true
      invalidatePortalSession()
      clearPortalData()
      loginForm.identifier = ''
      loginForm.portal_pin = ''
      checkinForm.identifier = ''
      checkinForm.purpose = ''
    })

    return {
      token, patient, loginForm, checkinForm, activeTab, tabs, loading, loggingIn,
      checkingIn, error, paymentsEnabled, paymentMessages, paymentMessageTypes, checkinResult, checkin,
      aheadInQueue, appointments, labResults, prescriptions, bills, paymentAmounts,
      canPayBill, isBillCancelled, isPayingBill, login, logout, loadPortalData, checkIn, payBill,
      outstanding, formatCurrency, formatDate, formatTime, formatLabel, getStatusColor
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
