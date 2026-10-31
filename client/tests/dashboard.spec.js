import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('axios', () => ({ default: { get: vi.fn(), defaults: { headers: { common: {} } } } }))
import axios from 'axios'
import Dashboard from '../src/views/dashboard/Dashboard.vue'
import { useAuthStore } from '../src/store/auth'
import { useUiStore } from '../src/store/ui'

const dashboard = {
  stats: {
    totalPatients: 1284, totalDoctors: 32, todayAppointments: 47, pendingAppointments: 12,
    todayRevenue: 1850000, monthlyRevenue: 42600000, pendingBills: 23, pendingLabOrders: 9, lowStockMedications: 0
  },
  recentAppointments: [
    { id: 1, appointment_time: '08:30:00', patient_first_name: 'Aline', patient_last_name: 'Uwase', doctor_last_name: 'Habimana', status: 'in_progress' }
  ],
  recentPatients: [{ id: 7, first_name: 'Jean', last_name: 'Mugisha', mrn: 'MRN-1', phone: '', status: 'active' }],
  weeklyStats: []
}

const stubs = {
  'router-link': { props: ['to'], template: '<a :href="to"><slot /></a>' },
  BarChart: { template: '<div class="bar-chart-stub" />' }
}

async function mountAs(role, extra = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.user = { id: 1, first_name: 'Salomo', last_name: 'A', role }
  auth.token = 't'
  axios.get.mockImplementation(url =>
    Promise.resolve({ data: url.includes('insights') ? { insights: extra.insights || [] } : dashboard })
  )
  const wrapper = mount(Dashboard, { global: { plugins: [pinia], stubs } })
  await flushPromises()
  return { wrapper, ui: useUiStore() }
}

describe('Dashboard', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('greets the signed-in user and shows the headline figures', async () => {
    const { wrapper } = await mountAs('admin')
    expect(wrapper.find('.page-title').text()).toMatch(/^Good (morning|afternoon|evening), Salomo$/)
    const text = wrapper.find('.kpi-grid').text()
    expect(text).toContain('1,284')
    expect(text).toContain('$1,850,000')
    expect(text).not.toContain('$1,850,000.00')
  })

  it('flags only the attention figures that are above zero', async () => {
    const { wrapper } = await mountAs('admin')
    const cells = wrapper.findAll('.kpi-cell')
    const bills = cells.find(c => c.text().includes('Unpaid Bills'))
    expect(bills.classes()).toContain('attention')
    // Zero low-stock medications means nothing needs doing, so no alert colour.
    const stock = cells.find(c => c.text().includes('Low Stock Alerts'))
    expect(stock).toBeTruthy()
    expect(stock.classes()).not.toContain('attention')
  })

  it('does not flag a zero-value attention card', async () => {
    const { wrapper } = await mountAs('pharmacist')
    const stock = wrapper.findAll('.kpi-cell').find(c => c.text().includes('Low Stock Alerts'))
    expect(stock).toBeTruthy()
    expect(stock.classes()).not.toContain('attention')
  })

  it('shows a pharmacist only the cards and panels their role may see', async () => {
    const { wrapper } = await mountAs('pharmacist')
    const labels = wrapper.findAll('.kpi-label').map(l => l.text())
    expect(labels).toEqual(['Active Doctors', 'Low Stock Alerts'])
    expect(wrapper.text()).not.toContain("Today's Appointments")
    expect(wrapper.text()).not.toContain('Recent Patients')
  })

  it('renders appointments and recent patients with a phone fallback', async () => {
    const { wrapper } = await mountAs('admin')
    expect(wrapper.find('.appt-table').text()).toContain('Aline Uwase')
    expect(wrapper.find('.appt-table').text()).toContain('Dr. Habimana')
    expect(wrapper.find('.patients-list').text()).toContain('No phone')
  })

  it('shows the empty state for the weekly chart when there is no data', async () => {
    const { wrapper } = await mountAs('admin')
    expect(wrapper.text()).toContain('No data yet')
    expect(wrapper.find('.bar-chart-stub').exists()).toBe(false)
  })

  it('only links an insight when the role may open its page', async () => {
    const insights = [
      { severity: 'warning', icon: '', title: 'Low stock', message: 'm', link: '/pharmacy' },
      { severity: 'info', icon: '', title: 'Busy', message: 'm', link: '/appointments' }
    ]
    const { wrapper } = await mountAs('doctor', { insights })
    const cards = wrapper.findAll('.insight-card')
    expect(cards).toHaveLength(2)
    const pharmacy = cards.find(c => c.text().includes('Low stock'))
    const appointments = cards.find(c => c.text().includes('Busy'))
    expect(pharmacy.element.tagName).toBe('DIV')
    expect(appointments.element.tagName).toBe('A')
  })

  it('switches language without reloading', async () => {
    const { wrapper, ui } = await mountAs('admin')
    ui.setLocale('fr')
    await flushPromises()
    expect(wrapper.find('.page-title').text()).toMatch(/^(Bonjour|Bon après-midi|Bonsoir), Salomo$/)
    expect(wrapper.text()).toContain('Total des patients')
    ui.setLocale('rw')
    await flushPromises()
    expect(wrapper.text()).toContain('Abarwayi bose')
    expect(document.documentElement.getAttribute('lang')).toBe('rw')
  })

  it('remembers the chosen language', async () => {
    const { ui } = await mountAs('admin')
    ui.setLocale('fr')
    expect(localStorage.getItem('locale')).toBe('fr')
    ui.setLocale('de') // unsupported, ignored
    expect(ui.locale).toBe('fr')
  })
})
