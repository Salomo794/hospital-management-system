<template>
  <div class="bill-detail">
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>Loading bill details...</p>
    </div>

    <div v-else-if="error" class="loading-state">
      <p>{{ error }}</p>
      <button class="btn btn-primary" @click="loadBill">Retry</button>
    </div>

    <template v-else-if="bill">
      <div class="detail-header">
        <button class="btn btn-sm" @click="$router.back()">&larr; Back</button>
        <div class="record-title">
          <h2>Bill {{ bill.bill_number }}</h2>
          <span class="text-muted">{{ formatDateTime(bill.created_at) }}</span>
        </div>
        <span class="badge" :class="'badge-' + getStatusColor(bill.payment_status)">{{ bill.payment_status }}</span>
        <button class="btn btn-sm btn-outline" @click="printBill">🖨 Print</button>
      </div>

      <div class="bill-grid">
        <div class="card">
          <div class="card-header"><h3>Patient Details</h3></div>
          <div class="card-body">
            <div class="info-row"><label>Name:</label><span>{{ bill.patient_first_name }} {{ bill.patient_last_name }}</span></div>
            <div class="info-row"><label>MRN:</label><span>{{ bill.mrn }}</span></div>
            <div class="info-row" v-if="bill.patient_phone"><label>Phone:</label><span>{{ bill.patient_phone }}</span></div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3>Bill Summary</h3></div>
          <div class="card-body">
            <div class="info-row"><label>Total:</label><span>{{ formatCurrency(bill.total_amount) }}</span></div>
            <div class="info-row"><label>Discount:</label><span>-{{ formatCurrency(bill.discount) }}</span></div>
            <div class="info-row"><label>Tax:</label><span>{{ formatCurrency(bill.tax) }}</span></div>
            <div class="info-row total"><label>Net Amount:</label><span>{{ formatCurrency(bill.net_amount) }}</span></div>
            <div class="info-row"><label>Paid:</label><span class="text-success">{{ formatCurrency(bill.paid_amount) }}</span></div>
            <div class="info-row"><label>Balance:</label><span class="text-danger">{{ formatCurrency(outstandingBalance) }}</span></div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-header"><h3>Bill Items</h3></div>
        <table class="data-table">
          <thead><tr><th>Description</th><th>Category</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
          <tbody>
            <tr v-for="item in bill.items" :key="item.id">
              <td>{{ item.description }}</td>
              <td><span class="badge badge-info">{{ item.category }}</span></td>
              <td>{{ item.quantity }}</td>
              <td>{{ formatCurrency(item.unit_price) }}</td>
              <td>{{ formatCurrency(item.total) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card" style="margin-top:16px">
        <div class="card-header"><h3>Payment History</h3></div>
        <div class="card-body">
          <div v-if="bill.payments && bill.payments.length">
            <div v-for="p in bill.payments" :key="p.id" class="payment-item">
              <div class="payment-info">
                <strong>{{ formatCurrency(p.amount) }}</strong>
                <span>{{ paymentMethodLabel(p.payment_method) }} | {{ formatDate(p.payment_date) }}</span>
                <span v-if="p.transaction_reference" class="text-muted">Ref: {{ p.transaction_reference }}</span>
                <span v-if="Number(p.refunded_amount) > 0" class="badge badge-danger">
                  Refunded {{ formatCurrency(p.refunded_amount) }}
                </span>
                <span v-if="p.status && p.status !== 'completed'" class="badge" :class="'badge-' + (p.status === 'failed' ? 'danger' : 'warning')">
                  {{ p.status }}
                </span>
              </div>
              <button
                v-if="refundableFor(p) > 0"
                class="btn btn-sm btn-outline"
                @click="openRefundModal(p)"
              >
                Refund
              </button>
            </div>
          </div>
          <div v-else class="empty-state">
            <span class="empty-icon">💰</span>
            <p>No payments recorded yet.</p>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:16px" v-if="bill.refunds && bill.refunds.length">
        <div class="card-header"><h3>Refunds</h3></div>
        <table class="data-table">
          <thead>
            <tr><th>Refund #</th><th>Amount</th><th>Method</th><th>Reason</th><th>By</th><th>Date</th></tr>
          </thead>
          <tbody>
            <tr v-for="r in bill.refunds" :key="r.id">
              <td>{{ r.refund_number }}</td>
              <td class="text-danger">{{ formatCurrency(r.amount) }}</td>
              <td>{{ paymentMethodLabel(r.payment_method) }}</td>
              <td>{{ r.reason }}</td>
              <td>{{ r.refunded_by_name }} {{ r.refunded_by_last_name }}</td>
              <td>{{ formatDate(r.refund_date) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="action-bar" v-if="outstandingBalance > 0 && bill.payment_status !== 'cancelled'">
        <button class="btn btn-success" @click="openPaymentModal">Record Payment</button>
      </div>

      <!-- Payment Modal -->
      <div class="modal-overlay" v-if="showPaymentModal" @click.self="showPaymentModal = false">
        <div class="modal">
          <div class="modal-header">
            <h3>Record Payment</h3>
            <button class="modal-close" @click="showPaymentModal = false">&times;</button>
          </div>
          <div class="modal-body">
            <form @submit.prevent="recordPayment">
              <div class="form-group">
                <label>Amount *</label>
                <input type="number" step="0.01" min="0.01" v-model.number="paymentForm.amount" :max="outstandingBalance" required />
              </div>
              <div class="form-group">
                <label>Payment Method *</label>
                <select v-model="paymentForm.payment_method" required>
                  <option v-for="method in staffPaymentMethods" :key="method.value" :value="method.value">
                    {{ method.label }}
                  </option>
                </select>
              </div>
              <div class="form-group" v-if="paymentForm.payment_method === MOBILE_MONEY_METHOD">
                <!-- Two ways to take mobile money. Assisted needs nothing but a
                     confirmation code; the request flow needs a provider and is
                     only offered when one is configured. -->
                <div class="notice">
                  <template v-if="mobileMoneyConfig.enabled">
                    Send the request to the patient's phone and they approve it there,
                    or record a transfer they have already made.
                  </template>
                  <template v-else>
                    Record a transfer the patient has already made to the hospital's
                    mobile money number. Enter the confirmation code from their phone.
                  </template>
                </div>
                <div class="form-group" v-if="mobileMoneyConfig.enabled">
                  <label class="radio-label">
                    <input type="radio" v-model="mobileMoneyMode" value="request" />
                    Send request to their phone
                  </label>
                  <label class="radio-label">
                    <input type="radio" v-model="mobileMoneyMode" value="assisted" />
                    They already transferred
                  </label>
                </div>
                <template v-if="mobileMoneyMode === 'request' && mobileMoneyConfig.enabled">
                  <div class="form-group">
                    <label>Patient Mobile Money Number *</label>
                    <input v-model.trim="mobileMoneyForm.phone" placeholder="e.g. 0781234567" />
                  </div>
                  <div class="form-group">
                    <label>Network *</label>
                    <select v-model="mobileMoneyForm.network">
                      <option value="" disabled>Select network</option>
                      <option v-for="network in mobileMoneyConfig.networks" :key="network.value" :value="network.value">
                        {{ network.label }}
                      </option>
                    </select>
                  </div>
                </template>
                <div class="form-group">
                  <label>{{ mobileMoneyMode === 'request' && mobileMoneyConfig.enabled ? 'Email for receipt (optional)' : 'Confirmation Code *' }}</label>
                  <input
                    v-if="mobileMoneyMode === 'request' && mobileMoneyConfig.enabled"
                    v-model.trim="mobileMoneyForm.email"
                    type="email"
                    :placeholder="bill.patient_email || 'Receipt address'"
                  />
                  <input
                    v-else
                    v-model.trim="paymentForm.transaction_reference"
                    placeholder="e.g. MP260716.1234.A45678"
                    required
                  />
                  <small class="text-muted" v-if="!(mobileMoneyMode === 'request' && mobileMoneyConfig.enabled)">
                    This is the code the patient received on their phone. It is the
                    only proof the money arrived, so it is required.
                  </small>
                </div>
              </div>
              <div class="form-group" v-else>
                <label>Transaction Reference</label>
                <input v-model="paymentForm.transaction_reference" />
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" @click="showPaymentModal = false">Cancel</button>
                <button type="submit" class="btn btn-success" :disabled="recordingPayment">
                  {{ recordingPayment ? 'Saving...' : submitLabel }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>

      <!-- Pending mobile money charge: shown while the patient approves -->
      <div class="modal-overlay" v-if="pendingCharge">
        <div class="modal">
          <div class="modal-header">
            <h3>Awaiting Patient Approval</h3>
            <button class="modal-close" @click="dismissPending">&times;</button>
          </div>
          <div class="modal-body">
            <div class="notice">
              {{ formatCurrency(pendingCharge.amount) }} was sent to
              <strong>{{ mobileMoneyConfig.networks.find(n => n.value === pendingCharge.network)?.label || pendingCharge.network }}</strong>
              number ending <strong>{{ pendingCharge.phone_tail }}</strong>.
              The patient must approve the prompt on their phone. This bill is
              <strong>not</strong> paid until that happens.
            </div>
            <div class="info-row"><label>Request:</label><span>{{ pendingCharge.payment_number }}</span></div>
            <div class="info-row"><label>Status:</label><span>{{ pendingCharge.status }}</span></div>
            <div class="info-row" v-if="pendingCharge.failure_reason">
              <label>Reason:</label><span class="text-danger">{{ pendingCharge.failure_reason }}</span>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" @click="checkPendingCharge(false)">Check again</button>
              <button type="button" class="btn btn-primary" :disabled="checkingPending" @click="checkPendingCharge(true)">
                {{ checkingPending ? 'Checking...' : 'Patient says they approved' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Refund Modal -->
      <div class="modal-overlay" v-if="showRefundModal" @click.self="closeRefundModal">
        <div class="modal">
          <div class="modal-header">
            <h3>Refund Payment</h3>
            <button class="modal-close" @click="closeRefundModal">&times;</button>
          </div>
          <div class="modal-body">
            <form @submit.prevent="submitRefund">
              <p class="text-muted" style="margin-bottom:12px">
                Reversing <strong>{{ refundTarget?.payment_number }}</strong> of
                {{ formatCurrency(refundTarget?.amount) }} taken by
                {{ paymentMethodLabel(refundTarget?.payment_method) }}.
                The original payment is kept and a refund record is added.
              </p>
              <div class="form-group">
                <label>Refund Amount *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  v-model.number="refundForm.amount"
                  :max="refundTarget ? refundableFor(refundTarget) : 0"
                  required
                />
                <small class="text-muted">Maximum refundable: {{ formatCurrency(refundTarget ? refundableFor(refundTarget) : 0) }}</small>
              </div>
              <div class="form-group">
                <label>Reason *</label>
                <textarea
                  v-model="refundForm.reason"
                  rows="2"
                  maxlength="500"
                  placeholder="Why is this being reversed? This is recorded in the audit log."
                  required
                ></textarea>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" @click="closeRefundModal">Cancel</button>
                <button
                  type="submit"
                  class="btn btn-danger"
                  :disabled="processingRefund || refundForm.reason.trim().length < 3"
                >
                  {{ processingRefund ? 'Processing...' : 'Confirm Refund' }}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import axios from 'axios'
import { useToast } from '../../store/toast'
import { formatDate, formatDateTime, formatCurrency, getStatusColor } from '../../utils/helpers'
import { fetchPaymentMethods, fetchMobileMoneyConfig, paymentMethodLabel, MOBILE_MONEY_METHOD, disabledMobileMoney } from '../../utils/paymentMethods'

export default {
  name: 'BillDetail',
  setup() {
    const route = useRoute()
    const toast = useToast()
    const bill = ref(null)
    const loading = ref(true)
    const error = ref('')
    const showPaymentModal = ref(false)
    const recordingPayment = ref(false)
    const paymentForm = ref({ amount: 0, payment_method: 'cash', transaction_reference: '' })
    const paymentMethods = ref([])
    const showRefundModal = ref(false)
    const processingRefund = ref(false)
    const refundTarget = ref(null)
    const refundForm = ref({ amount: 0, reason: '' })
    const mobileMoneyConfig = ref(disabledMobileMoney)
    const mobileMoneyForm = ref({ phone: '', network: '', email: '' })
    const mobileMoneyMode = ref('assisted')
    const pendingCharge = ref(null)
    const checkingPending = ref(false)
    const outstandingBalance = computed(() => Math.max(Number(bill.value?.net_amount || 0) - Number(bill.value?.paid_amount || 0), 0))

    // The button has to say what pressing it actually does. "Send Request"
    // leaves the bill unpaid, "Record Payment" settles it now, and mixing the
    // two up at a counter is how patients get told they have paid when they
    // have not.
    const submitLabel = computed(() => {
      if (usesMobileMoneyRequest()) return 'Send Request'
      return 'Record Payment'
    })

    // Mobile money is always offered. Without a configured provider it records
    // an assisted payment: the patient transferred to the hospital's MoMo
    // number and reception enters the confirmation code. With a provider the
    // request can instead be pushed to the patient's phone. Hiding the method
    // until a provider exists would leave the hospital unable to take the most
    // common payment in the country.
    const staffPaymentMethods = computed(() => paymentMethods.value)

    const loadPaymentMethods = async () => {
      const [methods, mobileMoney] = await Promise.all([
        fetchPaymentMethods(),
        fetchMobileMoneyConfig()
      ])
      paymentMethods.value = methods
      mobileMoneyConfig.value = mobileMoney
    }

    const loadBill = async () => {
      loading.value = true
      error.value = ''
      bill.value = null
      try {
        const { data } = await axios.get(`/api/billing/${route.params.id}`)
        bill.value = data
      } catch (e) {
        error.value = e.response?.data?.message || 'Failed to load bill details.'
        toast.error(error.value)
      } finally {
        loading.value = false
      }
    }

    const openPaymentModal = () => {
      paymentForm.value = {
        amount: outstandingBalance.value,
        payment_method: 'cash',
        transaction_reference: ''
      }
      // Prefill what the hospital already knows about the patient so reception
      // is not retyping a number that is on file.
      mobileMoneyForm.value = {
        phone: bill.value?.patient_phone || '',
        network: '',
        email: bill.value?.patient_email || ''
      }
      // Assisted is the default: it needs no provider, so it is the option that
      // always works.
      mobileMoneyMode.value = 'assisted'
      showPaymentModal.value = true
    }

    const usesMobileMoneyRequest = () => (
      paymentForm.value.payment_method === MOBILE_MONEY_METHOD
      && mobileMoneyConfig.value.enabled
      && mobileMoneyMode.value === 'request'
    )

    const requestMobileMoney = async () => {
      const { phone, network } = mobileMoneyForm.value
      if (!phone || !network) {
        toast.warning('A mobile money number and network are required.')
        return
      }
      recordingPayment.value = true
      try {
        const { data } = await axios.post(`/api/billing/${route.params.id}/mobile-money`, {
          phone,
          network,
          email: mobileMoneyForm.value.email || undefined
        })
        showPaymentModal.value = false
        pendingCharge.value = {
          id: data.payment.id,
          payment_number: data.payment.payment_number,
          amount: data.payment.amount,
          network,
          phone_tail: String(phone).slice(-4),
          status: data.payment.status
        }
        toast.info(data.message || 'Request sent. Waiting for the patient to approve.')
        loadBill()
      } catch (e) {
        toast.error(e.response?.data?.message || 'Could not send the mobile money request')
      } finally {
        recordingPayment.value = false
      }
    }

    const recordPayment = async () => {
      if (usesMobileMoneyRequest()) {
        await requestMobileMoney()
        return
      }
      const amount = Number(paymentForm.value.amount)
      if (!Number.isFinite(amount) || amount <= 0 || amount > outstandingBalance.value) {
        toast.warning('Enter a positive amount within the outstanding balance.')
        return
      }
      // Assisted mobile money is recorded as settled money the moment reception
      // saves it, so the confirmation code is checked here rather than after.
      if (paymentForm.value.payment_method === MOBILE_MONEY_METHOD && paymentForm.value.transaction_reference.trim().length < 4) {
        toast.warning('Enter the confirmation code from the patient\'s phone.')
        return
      }
      recordingPayment.value = true
      try {
        await axios.post(`/api/billing/${route.params.id}/payments`, paymentForm.value)
        showPaymentModal.value = false
        paymentForm.value = { amount: 0, payment_method: 'cash', transaction_reference: '' }
        toast.success('Payment recorded successfully.')
        loadBill()
      } catch (e) {
        toast.error(e.response?.data?.message || 'Error recording payment')
      } finally {
        recordingPayment.value = false
      }
    }

    // `sync` asks the provider directly. Webhooks are the normal path, so this
    // exists for when a patient insists they approved and nothing has landed.
    const checkPendingCharge = async (sync = false) => {
      if (!pendingCharge.value) return
      checkingPending.value = true
      try {
        const { data } = await axios.get(
          `/api/billing/mobile-money/payments/${pendingCharge.value.id}${sync ? '?sync=1' : ''}`
        )
        pendingCharge.value = { ...pendingCharge.value, ...data.payment, status: data.payment.status }
        if (data.payment.status === 'completed') {
          toast.success(`Payment ${data.payment.payment_number} approved.`)
          dismissPending()
          loadBill()
        } else if (data.payment.status === 'failed') {
          toast.error(data.payment.failure_reason || 'The patient did not approve this payment.')
          loadBill()
        } else {
          toast.info('Still waiting for the patient to approve on their phone.')
        }
      } catch (e) {
        toast.error(e.response?.data?.message || 'Could not check this payment')
      } finally {
        checkingPending.value = false
      }
    }

    const dismissPending = () => {
      pendingCharge.value = null
    }

    const printBill = () => {
      window.print()
    }

    // Only settled money can be given back, and only what is left of it. A
    // pending mobile money charge never reached the hospital, and a fully
    // refunded payment has nothing left to reverse.
    const refundableFor = (payment) => {
      if (!payment) return 0
      if (payment.status && payment.status !== 'completed') return 0
      const amount = Number(payment.amount || 0)
      const refunded = Number(payment.refunded_amount || 0)
      return Math.max(Number((amount - refunded).toFixed(2)), 0)
    }

    const openRefundModal = (payment) => {
      refundTarget.value = payment
      refundForm.value = { amount: refundableFor(payment), reason: '' }
      showRefundModal.value = true
    }

    const closeRefundModal = () => {
      showRefundModal.value = false
      refundTarget.value = null
      refundForm.value = { amount: 0, reason: '' }
    }

    const submitRefund = async () => {
      const amount = Number(refundForm.value.amount)
      const max = refundableFor(refundTarget.value)
      if (!Number.isFinite(amount) || amount <= 0 || amount > max) {
        toast.warning(`Enter an amount between 0.01 and ${max}.`)
        return
      }
      if (refundForm.value.reason.trim().length < 3) {
        toast.warning('A reason is required so the reversal can be explained later.')
        return
      }
      processingRefund.value = true
      try {
        const { data } = await axios.post(
          `/api/billing/payments/${refundTarget.value.id}/refund`,
          { amount, reason: refundForm.value.reason.trim() }
        )
        toast.success(`Refund ${data.refund.refund_number} recorded.`)
        closeRefundModal()
        loadBill()
      } catch (e) {
        toast.error(e.response?.data?.message || 'Error recording refund')
      } finally {
        processingRefund.value = false
      }
    }

    onMounted(() => {
      loadBill()
      loadPaymentMethods()
    })
    watch(() => route.params.id, loadBill)
    return {
      bill, loading, error, showPaymentModal, recordingPayment, paymentForm, paymentMethods,
      staffPaymentMethods, mobileMoneyConfig, mobileMoneyForm, mobileMoneyMode, pendingCharge, checkingPending,
      outstandingBalance, submitLabel, loadBill, openPaymentModal, recordPayment, printBill, paymentMethodLabel,
      checkPendingCharge, dismissPending, MOBILE_MONEY_METHOD,
      showRefundModal, processingRefund, refundTarget, refundForm,
      refundableFor, openRefundModal, closeRefundModal, submitRefund,
      formatDate, formatDateTime, formatCurrency, getStatusColor
    }
  }
}
</script>

<style scoped>
.detail-header { display: flex; align-items: center; gap: 20px; margin-bottom: 24px; }
.record-title { flex: 1; }
.text-muted { color: var(--gray-400); font-size: 12px; }
.bill-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--gray-100); font-size: 14px; }
.info-row label { color: var(--gray-500); }
.info-row span { font-weight: 500; }
.info-row.total { border-bottom: none; font-weight: 700; font-size: 16px; }
.payment-item { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid var(--gray-100); }
.payment-info { display: flex; gap: 16px; align-items: center; font-size: 14px; }
.action-bar { margin-top: 20px; display: flex; justify-content: flex-end; }
.modal-close { background: none; border: none; font-size: 24px; cursor: pointer; color: var(--gray-500); }

.btn-outline { border: 1px solid var(--gray-200); background: var(--white); color: var(--gray-600); }
.btn-outline:hover { background: var(--gray-50); border-color: var(--gray-300); }

.empty-state { text-align: center; padding: 32px 16px; color: var(--gray-400); }
.empty-icon { font-size: 32px; display: block; margin-bottom: 8px; }

/* Explains that the money has not arrived yet, so it is never mistaken for a
   confirmation that it has. */
.notice {
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-left: 4px solid #f59e0b;
  border-radius: 6px;
  padding: 12px 14px;
  margin-bottom: 16px;
  font-size: 13px;
  color: #78350f;
  line-height: 1.5;
}

.radio-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--gray-700);
  font-weight: 400;
  margin-bottom: 6px;
  cursor: pointer;
}

.loading-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 80px 20px; color: var(--gray-500); }
.spinner { width: 40px; height: 40px; border: 4px solid var(--gray-200); border-top-color: #0d9488; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 16px; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 768px) {
  .bill-grid { grid-template-columns: 1fr; }
  .detail-header { flex-wrap: wrap; gap: 12px; }
  .action-bar { flex-direction: column; }
  .action-bar .btn { width: 100%; }
  .payment-info { flex-direction: column; gap: 4px; align-items: flex-start; }
}
@media print { .detail-header .btn, .action-bar { display: none; } .modal-overlay { display: none !important; } }
</style>
