<template>
  <div class="lab-order-detail" v-if="order">
    <div class="detail-header">
      <button class="btn btn-sm btn-back" @click="$router.back()">&larr; Back</button>
      <div class="record-title">
        <h2>Lab Order {{ order.order_number }}</h2>
        <span class="text-muted">{{ formatDate(order.order_date) }}</span>
      </div>
      <span class="badge badge-lg" :class="'badge-' + getStatusColor(order.status)">{{ order.status.replace('_', ' ') }}</span>
    </div>

    <div class="info-bar">
      <div class="info-item">
        <span class="info-label">Doctor</span>
        <span class="info-value">Dr. {{ order.doctor_first_name }} {{ order.doctor_last_name }}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Priority</span>
        <span class="badge" :class="priorityClass(order.priority)">{{ order.priority }}</span>
      </div>
      <div class="info-item" v-if="order.clinical_notes">
        <span class="info-label">Notes</span>
        <span class="info-value">{{ order.clinical_notes }}</span>
      </div>
    </div>

    <div class="demographics-card" v-if="order.patient_mrn || order.patient_gender || order.patient_dob">
      <h4>Patient Demographics</h4>
      <div class="demo-grid">
        <div class="demo-item" v-if="order.patient_mrn">
          <span class="demo-label">MRN</span>
          <span class="demo-value text-mono">{{ order.patient_mrn }}</span>
        </div>
        <div class="demo-item" v-if="order.patient_gender">
          <span class="demo-label">Gender</span>
          <span class="demo-value">{{ order.patient_gender }}</span>
        </div>
        <div class="demo-item" v-if="order.patient_dob">
          <span class="demo-label">Date of Birth</span>
          <span class="demo-value">{{ formatDate(order.patient_dob) }}</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h3>Test Results ({{ order.items.length }})</h3>
        <span v-if="order.critical_count" class="critical-summary">
          <span class="badge badge-danger">{{ order.critical_count }} critical</span>
        </span>
        <span v-else-if="order.abnormal_count" class="critical-summary">
          <span class="badge badge-warning">{{ order.abnormal_count }} abnormal</span>
        </span>
      </div>
      <div class="card-body">

        <div v-if="loading" class="loading-state">
          <div class="spinner"></div>
          <span>Loading lab order...</span>
        </div>

        <template v-else>
          <div v-if="order.items.length === 0" class="empty-state">
            <div class="empty-icon">&#9881;</div>
            <h4>No Test Items</h4>
            <p>This order has no associated test items.</p>
          </div>

          <div v-for="(item, idx) in order.items" :key="item.id" class="result-card">
            <div class="result-card-header" :class="{ 'abnormal': isAbnormal(item) }">
              <div class="result-card-title">
                <h4>{{ item.test_name }}</h4>
                <span class="badge badge-info">{{ item.category }}</span>
              </div>
              <span class="flag-badge" :class="'flag-' + flagClass(getFlag(item))">{{ flagLabel(getFlag(item)) }}</span>
            </div>

            <div class="result-card-body">
              <div class="result-grid">
                <div class="form-group">
                  <label>Result Value</label>
                  <input
                    v-model="item.result_value"
                    :disabled="order.status === 'completed'"
                    placeholder="Enter result..."
                  />
                </div>
                <div class="form-group">
                  <label>Unit</label>
                  <input
                    v-model="item.result_unit"
                    :disabled="order.status === 'completed'"
                    placeholder="e.g. mg/dL"
                  />
                </div>
                <div class="form-group">
                  <label>Reference Range</label>
                  <input
                    v-model="item.reference_range"
                    :disabled="order.status === 'completed'"
                    placeholder="e.g. 70-100"
                  />
                </div>
              </div>
              <div class="form-group">
                <label>Notes</label>
                <textarea
                  v-model="item.notes"
                  :disabled="order.status === 'completed'"
                  rows="2"
                  placeholder="Additional notes..."
                ></textarea>
              </div>
            </div>
          </div>
        </template>

      </div>
    </div>

    <div class="action-bar" v-if="order.status !== 'completed'">
      <button class="btn btn-primary" @click="submitResults" :disabled="saving">
        <span v-if="saving" class="btn-spinner"></span>
        {{ saving ? 'Submitting...' : 'Submit Results' }}
      </button>
    </div>
  </div>

  <div v-else-if="loading" class="loading-state">
    <div class="spinner"></div>
    <span>Loading lab order details...</span>
  </div>

  <div v-else-if="error" class="empty-state">
    <div class="empty-icon">&#9888;</div>
    <h4>Failed to Load Order</h4>
    <p>{{ error }}</p>
    <button class="btn btn-sm btn-outline" @click="$router.back()">Go Back</button>
  </div>
</template>

<script>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import axios from 'axios'
import { useToast } from '../../store/toast'
import { formatDate, getStatusColor } from '../../utils/helpers'

export default {
  name: 'LabOrderDetail',
  setup() {
    const route = useRoute()
    const router = useRouter()
    const toast = useToast()
    const order = ref(null)
    const saving = ref(false)
    const loading = ref(false)
    const error = ref('')

    const priorityClass = (priority) => {
      if (priority === 'stat') return 'badge-danger'
      if (priority === 'urgent') return 'badge-warning'
      return 'badge-info'
    }

    const isAbnormal = (item) => {
      const flag = getFlag(item)
      return flag === 'H' || flag === 'L' || flag === 'CRITICAL_H' || flag === 'CRITICAL_L'
    }

    const getFlag = (item) => {
      if (item.flag === 'CRITICAL_H' || item.flag === 'CRITICAL_L') return item.flag
      const val = parseFloat(item.result_value)
      if (!item.reference_range || isNaN(val)) return 'NORMAL'
      const match = item.reference_range.match(/([\d.]+)\s*[-–]\s*([\d.]+)/)
      if (!match) return 'NORMAL'
      const low = parseFloat(match[1])
      const high = parseFloat(match[2])
      if (val < low) return 'L'
      if (val > high) return 'H'
      return 'NORMAL'
    }

    const FLAG_META = {
      CRITICAL_H: { label: 'Critical High', cls: 'danger' },
      CRITICAL_L: { label: 'Critical Low', cls: 'danger' },
      H: { label: 'High', cls: 'warning' },
      L: { label: 'Low', cls: 'warning' },
      NORMAL: { label: 'Normal', cls: 'success' },
      UNKNOWN: { label: 'Unknown', cls: 'gray' }
    }

    const flagLabel = (flag) => (FLAG_META[flag] || FLAG_META.UNKNOWN).label
    const flagClass = (flag) => (FLAG_META[flag] || FLAG_META.UNKNOWN).cls

    const submitResults = async () => {
      saving.value = true
      try {
        await axios.put(`/api/laboratory/orders/${route.params.id}/results`, {
          items: order.value.items
        })
        toast.success('Lab results submitted successfully')
        router.push('/laboratory')
      } catch (e) {
        toast.error(e.response?.data?.message || 'Error submitting results')
      } finally {
        saving.value = false
      }
    }

    onMounted(async () => {
      loading.value = true
      try {
        const { data } = await axios.get(`/api/laboratory/orders/${route.params.id}`)
        order.value = data
      } catch (e) {
        error.value = e.response?.data?.message || 'Failed to load lab order details'
        toast.error(error.value)
      } finally {
        loading.value = false
      }
    })

    return {
      order, saving, loading, error,
      priorityClass, isAbnormal, getFlag, flagLabel, flagClass,
      formatDate, getStatusColor, submitResults
    }
  }
}
</script>

<style scoped>
.lab-order-detail {
  padding: 24px;
  max-width: 1000px;
  margin: 0 auto;
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: 20px;
}

.btn-back {
  flex-shrink: 0;
}

.record-title {
  flex: 1;
}

.record-title h2 {
  font-size: 20px;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 2px 0;
}

.badge-lg {
  font-size: 13px;
  padding: 5px 14px;
}

.text-muted {
  color: #94a3b8;
  font-size: 13px;
}

.text-mono {
  font-family: monospace;
  font-size: 13px;
}

/* Info bar */
.info-bar {
  display: flex;
  gap: 28px;
  background: white;
  padding: 14px 20px;
  border-radius: 10px;
  margin-bottom: 16px;
  font-size: 14px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  border: 1px solid #f1f5f9;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.info-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #94a3b8;
}

.info-value {
  color: #334155;
  font-weight: 500;
}

/* Demographics */
.demographics-card {
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 16px 20px;
  margin-bottom: 16px;
}

.demographics-card h4 {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #94a3b8;
  margin: 0 0 12px 0;
}

.demo-grid {
  display: flex;
  gap: 32px;
}

.demo-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.demo-label {
  font-size: 11px;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.demo-value {
  font-size: 14px;
  font-weight: 600;
  color: #1e293b;
}

/* Loading */
.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 48px 20px;
  color: #94a3b8;
  font-size: 14px;
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #e2e8f0;
  border-top-color: #0d9488;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 48px 20px;
  text-align: center;
}

.empty-icon {
  font-size: 40px;
  line-height: 1;
  margin-bottom: 4px;
}

.empty-state h4 {
  font-size: 16px;
  font-weight: 600;
  color: #334155;
  margin: 0;
}

.empty-state p {
  font-size: 14px;
  color: #94a3b8;
  margin: 0;
}

/* Result cards */
.result-card {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  margin-bottom: 14px;
  overflow: hidden;
  transition: box-shadow 0.15s ease;
}

.result-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.result-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}

.result-card-header.abnormal {
  background: #fef2f2;
  border-bottom-color: #fecaca;
}

.result-card-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.result-card-title h4 {
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
  margin: 0;
}

.abnormal-badge {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #dc2626;
  background: #fee2e2;
  padding: 3px 10px;
  border-radius: 4px;
}

.flag-badge {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 3px 10px;
  border-radius: 4px;
}
.flag-danger { color: #dc2626; background: #fee2e2; }
.flag-warning { color: #b45309; background: #fef3c7; }
.flag-success { color: #16a34a; background: #dcfce7; }
.flag-gray { color: #64748b; background: #f1f5f9; }

.critical-summary { display: flex; gap: 6px; }

.normal-badge {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #16a34a;
  background: #dcfce7;
  padding: 3px 10px;
  border-radius: 4px;
}

.result-card-body {
  padding: 16px 18px;
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin-bottom: 14px;
}

.form-group label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  color: #94a3b8;
  margin-bottom: 4px;
}

.form-group input,
.form-group textarea {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 14px;
  color: #334155;
  background: white;
  box-sizing: border-box;
  transition: border-color 0.15s ease;
}

.form-group input:focus,
.form-group textarea:focus {
  outline: none;
  border-color: #0d9488;
  box-shadow: 0 0 0 3px rgba(13, 148, 136, 0.1);
}

.form-group input:disabled,
.form-group textarea:disabled {
  background: #f1f5f9;
  color: #94a3b8;
  cursor: not-allowed;
}

/* Action bar */
.action-bar {
  margin-top: 24px;
  display: flex;
  justify-content: flex-end;
}

.btn-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  margin-right: 6px;
  vertical-align: middle;
}
</style>
