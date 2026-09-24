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
                <span>{{ p.payment_method }} | {{ formatDate(p.payment_date) }}</span>
                <span v-if="p.transaction_reference" class="text-muted">Ref: {{ p.transaction_reference }}</span>
              </div>
            </div>
          </div>
          <div v-else class="empty-state">
            <span class="empty-icon">💰</span>
            <p>No payments recorded yet.</p>
          </div>
        </div>
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
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="insurance">Insurance</option>
                  <option value="online">Online</option>
                  <option value="bank_transfer">Bank Transfer</option>
                </select>
              </div>
              <div class="form-group">
                <label>Transaction Reference</label>
                <input v-model="paymentForm.transaction_reference" />
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" @click="showPaymentModal = false">Cancel</button>
                <button type="submit" class="btn btn-success" :disabled="recordingPayment">
                  {{ recordingPayment ? 'Recording...' : 'Record Payment' }}
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
    const outstandingBalance = computed(() => Math.max(Number(bill.value?.net_amount || 0) - Number(bill.value?.paid_amount || 0), 0))

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
      showPaymentModal.value = true
    }

    const recordPayment = async () => {
      const amount = Number(paymentForm.value.amount)
      if (!Number.isFinite(amount) || amount <= 0 || amount > outstandingBalance.value) {
        toast.warning('Enter a positive amount within the outstanding balance.')
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

    const printBill = () => {
      window.print()
    }

    onMounted(loadBill)
    watch(() => route.params.id, loadBill)
    return {
      bill, loading, error, showPaymentModal, recordingPayment, paymentForm, outstandingBalance,
      loadBill, openPaymentModal, recordPayment, printBill,
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
