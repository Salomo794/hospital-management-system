<template>
  <div class="ai-assistant">
    <div class="card chat-container">
      <div class="card-header">
        <h3>AI Assistant</h3>
        <span class="badge badge-success">Online</span>
      </div>
      <div class="chat-messages" ref="chatContainer">
        <!-- Welcome message -->
        <div class="message system">
          <div class="message-avatar">&#129302;</div>
          <div class="message-content">
            <div class="message-text">Hello! I'm your AI Hospital Assistant. I can help you find patient information, check schedules, and more. Try asking me:</div>
            <div class="quick-actions">
              <button v-for="action in quickActions" :key="action.label" @click="sendMessage(action.message)">
                {{ action.label }}
              </button>
            </div>
          </div>
        </div>

        <!-- Conversation messages -->
        <div v-for="(msg, idx) in messages" :key="idx" class="message" :class="msg.role">
          <div class="message-avatar" v-if="msg.role === 'system'">&#129302;</div>
          <div class="message-avatar user-avatar" v-else>&#128100;</div>
          <div class="message-content">
            <div class="message-text">{{ msg.text }}</div>
            <div class="message-data" v-if="msg.data">
              <table class="data-table" v-if="Array.isArray(msg.data) && msg.data.length">
                <thead>
                  <tr><th v-for="key in Object.keys(msg.data[0] || {})" :key="key">{{ formatKey(key) }}</th></tr>
                </thead>
                <tbody>
                  <tr v-for="(row, i) in msg.data" :key="i">
                    <td v-for="key in Object.keys(row)" :key="key">{{ formatValue(row[key]) }}</td>
                  </tr>
                </tbody>
              </table>
              <div class="data-object" v-else-if="typeof msg.data === 'object' && msg.data !== null">
                <div class="data-row" v-for="(val, key) in msg.data" :key="key">
                  <span class="data-key">{{ formatKey(key) }}:</span>
                  <span class="data-val">{{ formatValue(val) }}</span>
                </div>
              </div>
            </div>
            <div class="message-time" v-if="msg.timestamp">{{ formatTime(msg.timestamp) }}</div>
          </div>
        </div>

        <!-- Empty state -->
        <div v-if="!messages.length && !loading" class="empty-chat">
          <span class="empty-icon">🤖</span>
          <p>Start a conversation by typing a message below.</p>
        </div>

        <!-- Typing indicator -->
        <div v-if="loading" class="message system">
          <div class="message-avatar">&#129302;</div>
          <div class="message-content">
            <div class="typing-indicator"><span></span><span></span><span></span></div>
          </div>
        </div>
      </div>

      <div class="chat-input">
        <input
          ref="chatInput"
          v-model="input"
          @keyup.enter="sendMessage()"
          placeholder="Ask me anything about patients, appointments, or hospital data..."
        />
        <button class="btn btn-primary" @click="sendMessage()" :disabled="!input.trim() || loading">
          &#10148;
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, nextTick, onMounted } from 'vue'
import axios from 'axios'
import { useToast } from '../../store/toast'
import { useAuthStore } from '../../store/auth'
import { formatDateTime } from '../../utils/helpers'

export default {
  name: 'AIAssistant',
  setup() {
    const toast = useToast()
    const authStore = useAuthStore()
    const clinicalRoles = ['admin', 'receptionist', 'doctor', 'nurse']
    const operationsRoles = ['admin', 'receptionist', 'doctor', 'nurse']
    const quickActions = computed(() => [
      { label: "Today's Appointments", message: "Show today's appointments", roles: operationsRoles },
      { label: 'Pending Tasks', message: 'Show pending tasks', roles: operationsRoles },
      { label: 'Monthly Revenue', message: 'Show revenue this month', roles: ['admin'] },
      { label: 'Find Patient', message: 'find patient Smith', roles: clinicalRoles },
      { label: 'Ward Status', message: 'Ward status and bed occupancy', roles: operationsRoles },
      { label: 'Drug Interaction', message: 'interaction between Warfarin and Aspirin', roles: ['admin', 'doctor', 'nurse', 'pharmacist'] },
      { label: 'Abnormal Lab Results', message: 'abnormal lab results', roles: ['admin', 'doctor', 'nurse', 'lab_technician'] },
      { label: 'Patient Allergies', message: 'allergies of Maria Garcia', roles: clinicalRoles },
      { label: 'Low Stock', message: 'Check low stock medicines', roles: ['admin', 'pharmacist'] }
    ].filter(action => authStore.can(...action.roles)))
    const messages = ref([])
    const input = ref('')
    const loading = ref(false)
    const chatContainer = ref(null)
    const chatInput = ref(null)

    const scrollToBottom = () => {
      nextTick(() => {
        if (chatContainer.value) {
          chatContainer.value.scrollTop = chatContainer.value.scrollHeight
        }
      })
    }

    const sendMessage = async (text) => {
      const msg = text || input.value
      if (!msg.trim() || loading.value) return

      messages.value.push({ role: 'user', text: msg, timestamp: new Date() })
      input.value = ''
      loading.value = true
      scrollToBottom()

      try {
        const { data } = await axios.post('/api/ai/chat', { message: msg })
        messages.value.push({ role: 'system', text: data.response, data: data.data, timestamp: new Date() })
      } catch (e) {
        const responseText = e.response?.data?.response || e.response?.data?.message || 'Sorry, I encountered an error. Please try again.'
        toast.error(responseText)
        messages.value.push({ role: 'system', text: responseText, timestamp: new Date() })
      } finally {
        loading.value = false
      }
      scrollToBottom()
    }

    const formatKey = (key) => key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    const formatValue = (val) => {
      if (val === null || val === undefined) return '-'
      if (typeof val === 'number') return val.toLocaleString()
      return String(val)
    }
    const formatTime = (date) => {
      try { return formatDateTime(date) } catch { return '' }
    }

    onMounted(() => {
      chatInput.value?.focus()
    })

    return { messages, input, loading, chatContainer, chatInput, quickActions, sendMessage, formatKey, formatValue, formatTime }
  }
}
</script>

<style scoped>
.ai-assistant { height: calc(100vh - 140px); display: flex; flex-direction: column; }
.chat-container { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.chat-messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; }
.message { display: flex; gap: 12px; max-width: 80%; }
.message.user { align-self: flex-end; flex-direction: row-reverse; }
.message-avatar { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; }
.message.system .message-avatar { background: var(--brand-50); }
.user-avatar { background: #0d9488 !important; color: white; font-size: 14px; }
.message-content { background: var(--gray-50); padding: 12px 16px; border-radius: 12px; font-size: 14px; line-height: 1.6; position: relative; }
.message.user .message-content { background: #0d9488; color: white; }
.message-text { white-space: pre-wrap; }
.message-time { font-size: 11px; color: var(--gray-400); margin-top: 8px; text-align: right; }
.message.user .message-time { color: rgba(255,255,255,0.7); }
.quick-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.quick-actions button { padding: 6px 14px; border: 1px solid #0d9488; background: var(--white); color: #0d9488; border-radius: 20px; font-size: 12px; cursor: pointer; transition: all 0.2s; }
.quick-actions button:hover { background: #0d9488; color: white; }
.message-data { margin-top: 12px; }
.message-data .data-table { font-size: 12px; }
.data-object { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; background: var(--white); padding: 10px; border-radius: 8px; }
.data-row { display: flex; gap: 8px; font-size: 13px; }
.data-key { color: var(--gray-500); font-weight: 500; min-width: 120px; }
.data-val { color: var(--gray-800); }
.empty-chat { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; color: var(--gray-400); text-align: center; padding: 40px; }
.empty-chat .empty-icon { font-size: 48px; margin-bottom: 12px; }
.typing-indicator { display: flex; gap: 4px; padding: 4px 0; }
.typing-indicator span { width: 8px; height: 8px; border-radius: 50%; background: var(--gray-400); animation: typing 1.4s infinite; }
.typing-indicator span:nth-child(2) { animation-delay: 0.2s; }
.typing-indicator span:nth-child(3) { animation-delay: 0.4s; }
@keyframes typing { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
.chat-input { display: flex; gap: 8px; padding: 16px 20px; border-top: 1px solid var(--gray-200); background: var(--white); }
.chat-input input { flex: 1; padding: 12px 16px; border: 1px solid var(--gray-200); border-radius: 8px; font-size: 14px; outline: none; }
.chat-input input:focus { border-color: #0d9488; }
.chat-input .btn { padding: 12px 20px; font-size: 16px; }

/* Responsive */
@media (max-width: 768px) {
  .ai-assistant { height: calc(100vh - 120px); }
  .message { max-width: 100%; }
  .chat-messages { padding: 14px; }
  .chat-input { padding: 12px 14px; }
  .chat-input .btn { padding: 12px 16px; }
  .data-key { min-width: 90px; }
}

@media (max-width: 480px) {
  .message-content { font-size: 13px; padding: 10px 12px; }
  .quick-actions button { width: 100%; }
  .chat-input input { font-size: 13px; padding: 10px 12px; }
}
</style>
