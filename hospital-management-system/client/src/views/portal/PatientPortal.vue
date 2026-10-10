<template>
  <div class="portal-page">
    <header class="portal-header">
      <div class="portal-header-title">
        <strong>MediCare Patient Portal</strong>
        <span v-if="patient">{{ patient.first_name }} {{ patient.last_name }}</span>
      </div>
      <div class="portal-header-actions">
        <!-- A patient reaches this page without the staff header, so the theme
             control has to live here too. Same store and same stored key as the
             staff toggle, so the choice follows them between the two. -->
        <button
          type="button"
          class="theme-toggle"
          @click="uiStore.toggleDark()"
          :aria-label="uiStore.dark ? 'Switch to light mode' : 'Switch to dark mode'"
          :title="uiStore.dark ? 'Switch to light mode' : 'Switch to dark mode'"
        >
          <span v-html="uiStore.dark ? sunIcon : moonIcon" />
        </button>
        <button v-if="token" class="btn btn-sm btn-outline" @click="logout">Sign out</button>
      </div>
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
                <!-- Mobile money is offered alongside the card rail, and only
                     when the hospital actually has a provider configured. -->
                <select
                  v-if="paymentMethodOptions.length > 1"
                  v-model="paymentMethods[bill.id]"
                  :disabled="isPayingBill(bill.id)"
                  aria-label="Payment method"
                >
                  <option v-for="option in paymentMethodOptions" :key="option.value" :value="option.value">
                    {{ option.label }}
                  </option>
                </select>
                <template v-if="paymentMethods[bill.id] === 'mobile_money'">
                  <input
                    v-model.trim="mobileMoneyPhones[bill.id]"
                    type="tel"
                    placeholder="Mobile money number"
                    :disabled="isPayingBill(bill.id)"
                    aria-label="Mobile money number"
                  />
                  <select
                    v-model="mobileMoneyNetworks[bill.id]"
                    :disabled="isPayingBill(bill.id)"
                    aria-label="Mobile money network"
                  >
                    <option value="" disabled>Network</option>
                    <option v-for="network in mobileMoneyConfig.networks" :key="network.value" :value="network.value">
                      {{ network.label }}
                    </option>
                  </select>
                </template>
                <button class="btn btn-primary btn-sm" :disabled="isPayingBill(bill.id)" @click="payBill(bill)">
                  {{ isPayingBill(bill.id) ? 'Paying…' : (paymentMethods[bill.id] === 'mobile_money' ? 'Send Request' : 'Pay') }}
                </button>
              </div>
              <span v-else-if="isBillCancelled(bill)" class="badge badge-gray">Cancelled</span>
              <span v-else-if="!canPayAnything && outstanding(bill) > 0" class="badge badge-gray">Payment unavailable</span>
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
          <p v-if="!canPayAnything" class="payment-disabled-note">Online payments are currently unavailable. Please contact reception.</p>
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
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import axios from 'axios'
import { formatCurrency, formatDate, getStatusColor } from '../../utils/helpers'
import { getStoredItem, getStoredJson, removeStoredItem, setStoredItem, setStoredJson } from '../../utils/storage'
import { useUiStore } from '../../store/ui'

// The theme control in the header. The store is the same one the staff side uses,
// so the toggle writes the same key and the page follows the rest of the app.
const svg = body =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
const moonIcon = svg('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/>')
const sunIcon = svg('<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4 7 7M17 17l1.6 1.6M18.6 5.4 17 7M7 17l-1.6 1.6"/>')

export default {
  name: 'PatientPortal',
  setup() {
    const portalApi = axios.create({ baseURL: '/api' })
    const uiStore = useUiStore()
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
    const paymentMethods = reactive({})
    const mobileMoneyPhones = reactive({})
    const mobileMoneyNetworks = reactive({})
    const mobileMoneyConfig = ref({ enabled: false, provider: null, networks: [] })
    const mobileMoneyPaymentIds = reactive({})
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
    // Either rail can be available on its own: the card rail is a dev/test
    // stand-in, while mobile money needs a real provider. A bill is payable if
    // at least one of them is switched on.
    const canPayAnything = computed(() => paymentsEnabled.value || mobileMoneyConfig.value.enabled)
    const paymentMethodOptions = computed(() => {
      const options = []
      if (paymentsEnabled.value) options.push({ value: 'card', label: 'Card' })
      if (mobileMoneyConfig.value.enabled) options.push({ value: 'mobile_money', label: 'Mobile Money' })
      return options
    })
    const canPayBill = bill => canPayAnything.value && !isBillCancelled(bill) && outstanding(bill) > 0
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
        clearObject(paymentMethods)
        clearObject(mobileMoneyPhones)
        clearObject(mobileMoneyNetworks)
        if (profileData.mobile_money) {
          mobileMoneyConfig.value = {
            enabled: !!profileData.mobile_money.enabled,
            provider: profileData.mobile_money.provider || null,
            networks: Array.isArray(profileData.mobile_money.networks) ? profileData.mobile_money.networks : []
          }
        }
        const defaultMethod = paymentMethodOptions.value[0]?.value || ''
        bills.value.forEach(bill => {
          paymentAmounts[bill.id] = outstanding(bill)
          // Never leave a bill on mobile money once the rail is switched off.
          if (paymentMethods[bill.id] !== 'card' || !mobileMoneyConfig.value.enabled) {
            paymentMethods[bill.id] = defaultMethod
          }
          if (!mobileMoneyPhones[bill.id]) mobileMoneyPhones[bill.id] = patient.value?.phone || ''
          if (!mobileMoneyNetworks[bill.id]) mobileMoneyNetworks[bill.id] = mobileMoneyConfig.value.networks[0]?.value || ''
        })
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

    // Mobile money is settled on the patient's handset, so the bill is still
    // outstanding when this returns. The webhook is what normally settles it;
    // this poll is the patient being told, and lets a stuck charge be rechecked
    // against the provider rather than left showing "pending" forever.
    const MOBILE_MONEY_POLL_INTERVAL_MS = 4000
    const MOBILE_MONEY_POLL_ATTEMPTS = 30
    const pollMobileMoneyPayment = async (billId, paymentId, requestToken, requestSession) => {
      for (let attempt = 0; attempt < MOBILE_MONEY_POLL_ATTEMPTS; attempt += 1) {
        if (componentUnmounted || requestSession !== sessionGeneration || requestToken !== token.value) return
        try {
          const { data } = await portalApi.get(
            `/portal/bills/${billId}/mobile-money/${paymentId}${attempt > 0 ? '?sync=1' : ''}`,
            { headers: requestHeaders(requestToken) }
          )
          if (data.status === 'completed') {
            setPaymentMessage(billId, 'Payment approved. Thank you!', 'success')
            await loadPortalData()
            return
          }
          if (data.status === 'failed') {
            setPaymentMessage(billId, 'That payment was not approved. You can try again.', 'error')
            await loadPortalData()
            return
          }
        } catch (requestError) {
          if (axios.isCancel(requestError)) return
          if (requestError.response?.status === 401) { logout(); return }
        }
        await new Promise(resolve => setTimeout(resolve, MOBILE_MONEY_POLL_INTERVAL_MS))
      }
      setPaymentMessage(billId, 'Still waiting for approval on your phone. It will update here once you approve.', 'error')
    }

    const payBill = async bill => {
      const billId = bill.id
      const requestSession = sessionGeneration
      const requestToken = token.value
      if (!requestToken || paymentPending[billId] || !canPayBill(bill)) return

      const isMobileMoney = paymentMethods[billId] === 'mobile_money'
      if (isMobileMoney) {
        const phone = String(mobileMoneyPhones[billId] || '').trim()
        const network = String(mobileMoneyNetworks[billId] || '').trim()
        if (!phone || !network) {
          setPaymentMessage(billId, 'Enter your mobile money number and choose a network.', 'error')
          return
        }
      }

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
        const payload = {
          amount,
          payment_method: isMobileMoney ? 'mobile_money' : 'card',
          request_id: paymentRequestIds.get(billId)
        }
        if (isMobileMoney) {
          payload.phone = String(mobileMoneyPhones[billId]).trim()
          payload.network = mobileMoneyNetworks[billId]
        }
        const { data } = await portalApi.post(`/portal/bills/${billId}/pay`, payload, { headers: requestHeaders(requestToken), signal: controller.signal })
        if (
          componentUnmounted ||
          controller.signal.aborted ||
          requestSession !== sessionGeneration ||
          requestToken !== token.value
        ) return
        if (isMobileMoney) {
          // The money has not moved yet, so the bill is not refreshed and no
          // amount is treated as collected. Polling takes over from here.
          mobileMoneyPaymentIds[billId] = data.payment_id
          setPaymentMessage(billId, data.message || 'Approve the payment on your phone to complete it.', 'success')
          void pollMobileMoneyPayment(billId, data.payment_id, requestToken, requestSession)
          return
        }
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
      paymentMethods, mobileMoneyPhones, mobileMoneyNetworks, mobileMoneyConfig, mobileMoneyPaymentIds,
      canPayAnything, paymentMethodOptions,
      canPayBill, isBillCancelled, isPayingBill, login, logout, loadPortalData, checkIn, payBill,
      outstanding, formatCurrency, formatDate, formatTime, formatLabel, getStatusColor,
      uiStore, moonIcon, sunIcon
    }
  }
}
</script>

<style scoped>
/* The portal is opened by patients on their own phones, often at night, so it
   follows the same theme as the rest of the app. Every colour below is a design
   token rather than a literal, which is the whole fix: the tokens are remapped
   once on <html> for the dark theme, so none of these rules need a dark-specific
   twin. The two rules at the bottom are the only exceptions, and both are there
   for contrast rather than looks. */
.portal-page { min-height: 100vh; background: var(--bg-app); color: var(--gray-800); }
.portal-header { min-height: 64px; padding: 0 24px; display: flex; align-items: center; justify-content: space-between; background: var(--brand-700); color: #fff; }
.portal-header > div { display: flex; gap: 18px; align-items: center; }
.portal-header-actions { gap: 10px; }
.portal-header span { color: rgba(255,255,255,.75); font-size: 13px; }
.theme-toggle {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; padding: 0;
  background: rgba(255,255,255,.12); border: 1px solid rgba(255,255,255,.28);
  border-radius: 8px; color: #fff; cursor: pointer;
}
.theme-toggle:hover { background: rgba(255,255,255,.24); }
.theme-toggle :deep(svg) { width: 16px; height: 16px; }
.portal-shell { width: min(100% - 32px, 1000px); margin: 28px auto; display: grid; gap: 18px; }
.portal-card, .welcome-card { background: var(--surface); border: 1px solid var(--gray-200); border-radius: 14px; padding: 24px; box-shadow: var(--shadow-card); }
.auth-card, .kiosk-card { width: min(100%, 520px); justify-self: center; }
h1, h2, p { margin-top: 0; }
form, .payment-controls { display: grid; gap: 14px; }
label { display: grid; gap: 6px; font-size: 13px; font-weight: 600; }
input, select { width: 100%; padding: 10px 12px; border: 1px solid var(--gray-300); border-radius: 8px; font: inherit; background: var(--surface-elevated); color: var(--gray-800); }
.btn-block { width: 100%; }
.welcome-card { display: flex; justify-content: space-between; align-items: center; gap: 20px; }
.eyebrow { color: var(--brand-600); font-size: 12px; font-weight: 700; text-transform: uppercase; }
.welcome-card h1 { margin: 4px 0; }
.welcome-card p { margin: 0; color: var(--text-muted); }
.queue-card { display: grid; gap: 3px; padding: 14px 18px; border-radius: 10px; background: var(--brand-100); text-align: right; }
.queue-card span, .queue-card small { color: var(--brand-800); font-size: 12px; }
.portal-tabs { display: flex; gap: 8px; flex-wrap: wrap; }
.portal-tabs button { border: 1px solid var(--gray-300); background: var(--surface-elevated); color: var(--gray-700); border-radius: 8px; padding: 9px 14px; cursor: pointer; }
.portal-tabs button.active { background: var(--brand-600); border-color: var(--brand-600); color: #fff; }
.record-list { display: grid; }
.record-row, .bill-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--gray-200); }
.record-row:last-child, .bill-row:last-child { border-bottom: 0; }
.record-row div, .bill-summary { display: grid; gap: 4px; }
.record-row span, .bill-summary span { color: var(--text-muted); font-size: 13px; }
.payment-controls { grid-template-columns: 130px auto; align-items: center; }
.empty-copy { color: var(--text-muted); padding: 20px 0; }
.error-message, .success-message, .checkin-result { padding: 10px 12px; border-radius: 8px; font-size: 13px; }
/* The -fg tokens only exist in the dark theme, so the fallback supplies today's
   dark-on-pale colours in light mode and the retuned pair in dark mode. */
.error-message { color: var(--danger-fg, #991b1b); background: var(--danger-bg); }
.success-message, .checkin-result { color: var(--success-fg, #115e59); background: var(--success-bg); display: grid; gap: 4px; margin-top: 14px; }
.loading-state { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 50px; color: var(--text-muted); }
.spinner { width: 24px; height: 24px; border: 3px solid var(--gray-300); border-top-color: var(--brand-600); border-radius: 50%; animation: spin .8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* The only two rules that need to know the theme exists. Both are contrast, not
   decoration: --brand-600 clears the floor on white but not on the dark card, and
   the queue tint is pale enough that its dark-on-dark pairing has to be restated. */
:global([data-theme="dark"]) .eyebrow { color: var(--brand-300); }
:global([data-theme="dark"]) .queue-card span,
:global([data-theme="dark"]) .queue-card small { color: var(--gray-600); }
/* Tells the browser to render its own widgets - number spinners, the select
   dropdown, the autofill caret - against a dark surface. */
:global([data-theme="dark"]) .portal-page { color-scheme: dark; }

@media (max-width: 640px) { .portal-header-title { display: grid; gap: 2px; } .welcome-card, .record-row, .bill-row { align-items: flex-start; flex-direction: column; } .payment-controls { width: 100%; } }
</style>
