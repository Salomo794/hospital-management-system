import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../store/auth'

const routes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/auth/Login.vue'),
    meta: { guest: true }
  },
  {
    path: '/',
    component: () => import('../components/Layout.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', redirect: '/dashboard' },
      { path: 'dashboard', name: 'Dashboard', component: () => import('../views/dashboard/Dashboard.vue') },
      { path: 'patients', name: 'Patients', component: () => import('../views/patients/Patients.vue') },
      { path: 'patients/:id', name: 'PatientDetail', component: () => import('../views/patients/PatientDetail.vue') },
      { path: 'doctors', name: 'Doctors', component: () => import('../views/doctors/Doctors.vue') },
      { path: 'appointments', name: 'Appointments', component: () => import('../views/appointments/Appointments.vue') },
      { path: 'emr', name: 'EMR', component: () => import('../views/emr/EMR.vue') },
      { path: 'emr/:id', name: 'EMRDetail', component: () => import('../views/emr/EMRDetail.vue') },
      { path: 'pharmacy', name: 'Pharmacy', component: () => import('../views/pharmacy/Pharmacy.vue') },
      { path: 'laboratory', name: 'Laboratory', component: () => import('../views/laboratory/Laboratory.vue') },
      { path: 'laboratory/orders/:id', name: 'LabOrderDetail', component: () => import('../views/laboratory/LabOrderDetail.vue') },
      { path: 'billing', name: 'Billing', component: () => import('../views/billing/Billing.vue') },
      { path: 'billing/:id', name: 'BillDetail', component: () => import('../views/billing/BillDetail.vue') },
      { path: 'reports', name: 'Reports', component: () => import('../views/reports/Reports.vue') },
      { path: 'admissions', name: 'Admissions', component: () => import('../views/admissions/Admissions.vue') },
      { path: 'ai-assistant', name: 'AI Assistant', component: () => import('../views/ai/AIAssistant.vue') },
      { path: 'users', name: 'Users', component: () => import('../views/dashboard/Users.vue') },
      { path: 'audit-log', name: 'Audit Log', component: () => import('../views/audit/AuditLog.vue') },
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to, from, next) => {
  const authStore = useAuthStore()
  if (to.matched.some(record => record.meta.requiresAuth) && !authStore.isAuthenticated) {
    next('/login')
  } else if (to.matched.some(record => record.meta.guest) && authStore.isAuthenticated) {
    next('/dashboard')
  } else {
    next()
  }
})

export default router
