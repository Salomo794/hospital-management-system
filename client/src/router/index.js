import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../store/auth'

const routes = [
  {
    path: '/portal',
    name: 'PatientPortal',
    component: () => import('../views/portal/PatientPortal.vue'),
    meta: { portal: true, title: 'Patient portal' }
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/auth/Login.vue'),
    meta: { guest: true, title: 'Sign in' }
  },
  {
    path: '/',
    component: () => import('../components/Layout.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', redirect: '/dashboard' },
      { path: 'dashboard', name: 'Dashboard', component: () => import('../views/dashboard/Dashboard.vue'), meta: { title: 'Dashboard' } },
      { path: 'patients', name: 'Patients', component: () => import('../views/patients/Patients.vue'), meta: { title: 'Patients', roles: ['admin', 'receptionist', 'doctor', 'nurse'] } },
      { path: 'patients/:id', name: 'PatientDetail', component: () => import('../views/patients/PatientDetail.vue'), meta: { title: 'Patient details', roles: ['admin', 'receptionist', 'doctor', 'nurse'] } },
      { path: 'doctors', name: 'Doctors', component: () => import('../views/doctors/Doctors.vue'), meta: { title: 'Doctors' } },
      { path: 'appointments', name: 'Appointments', component: () => import('../views/appointments/Appointments.vue'), meta: { title: 'Appointments', roles: ['admin', 'receptionist', 'doctor', 'nurse'] } },
      { path: 'emr', name: 'EMR', component: () => import('../views/emr/EMR.vue'), meta: { title: 'EMR', roles: ['admin', 'doctor', 'nurse'] } },
      { path: 'emr/:id', name: 'EMRDetail', component: () => import('../views/emr/EMRDetail.vue'), meta: { title: 'Medical record', roles: ['admin', 'doctor', 'nurse'] } },
      { path: 'ward', name: 'Ward', component: () => import('../views/ward/Ward.vue'), meta: { title: 'Ward', roles: ['admin', 'receptionist', 'doctor', 'nurse'] } },
      { path: 'pharmacy', name: 'Pharmacy', component: () => import('../views/pharmacy/Pharmacy.vue'), meta: { title: 'Pharmacy', roles: ['admin', 'pharmacist'] } },
      { path: 'procurement', name: 'Procurement', component: () => import('../views/procurement/Procurement.vue'), meta: { title: 'Procurement', roles: ['admin', 'pharmacist'] } },
      { path: 'laboratory', name: 'Laboratory', component: () => import('../views/laboratory/Laboratory.vue'), meta: { title: 'Laboratory', roles: ['admin', 'doctor', 'nurse', 'lab_technician'] } },
      { path: 'laboratory/orders/:id', name: 'LabOrderDetail', component: () => import('../views/laboratory/LabOrderDetail.vue'), meta: { title: 'Lab order', roles: ['admin', 'doctor', 'nurse', 'lab_technician'] } },
      { path: 'billing', name: 'Billing', component: () => import('../views/billing/Billing.vue'), meta: { title: 'Billing', roles: ['admin', 'receptionist'] } },
      { path: 'billing/:id', name: 'BillDetail', component: () => import('../views/billing/BillDetail.vue'), meta: { title: 'Bill details', roles: ['admin', 'receptionist'] } },
      { path: 'reports', name: 'Reports', component: () => import('../views/reports/Reports.vue'), meta: { title: 'Reports', roles: ['admin', 'receptionist', 'doctor', 'nurse'] } },
      { path: 'ai-assistant', name: 'AI Assistant', component: () => import('../views/ai/AIAssistant.vue'), meta: { title: 'AI Assistant' } },
      { path: 'users', name: 'Users', component: () => import('../views/dashboard/Users.vue'), meta: { title: 'Users', roles: ['admin'] } },
      { path: 'audit-log', name: 'AuditLog', component: () => import('../views/admin/AuditLog.vue'), meta: { title: 'Audit Log', roles: ['admin'] } }
    ]
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('../views/NotFound.vue'),
    meta: { requiresAuth: true, title: 'Page not found' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

let timezoneChecked = false

router.beforeEach(to => {
  if (to.meta.portal) return true
  const authStore = useAuthStore()
  // Ask the server which timezone to render in once per page load, so a change
  // to APP_TIMEZONE is picked up without the staff member signing out.
  if (!timezoneChecked && authStore.isAuthenticated) {
    timezoneChecked = true
    authStore.refreshTimezone()
  }
  if (to.matched.some(record => record.meta.requiresAuth) && !authStore.isAuthenticated) {
    return { name: 'Login', query: { redirect: to.fullPath } }
  }
  if (to.matched.some(record => record.meta.guest) && authStore.isAuthenticated) {
    return { name: 'Dashboard' }
  }
  const roles = to.matched.find(record => Array.isArray(record.meta.roles))?.meta.roles
  if (roles && !authStore.can(...roles)) {
    return { name: 'Dashboard', query: { access: 'denied' } }
  }
  return true
})

router.afterEach(to => {
  document.title = to.meta.title ? `${to.meta.title} | MediCare HMS` : 'MediCare HMS'
})

export default router
