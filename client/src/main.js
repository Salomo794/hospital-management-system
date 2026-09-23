import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './assets/styles.css'
import { Chart as ChartJS, Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale, ArcElement, LineElement, PointElement } from 'chart.js'
import { Bar, Doughnut, Line } from 'vue-chartjs'

ChartJS.register(Title, Tooltip, Legend, BarElement, CategoryScale, LinearScale, ArcElement, LineElement, PointElement)

const app = createApp(App)
const pinia = createPinia()
app.use(pinia)
app.use(router)

// Apply saved dark/light theme before first paint to avoid a flash of the wrong theme
import { useUiStore } from './store/ui'
useUiStore(pinia).applyTheme()

app.component('BarChart', Bar)
app.component('DoughnutChart', Doughnut)
app.component('LineChart', Line)
app.mount('#app')