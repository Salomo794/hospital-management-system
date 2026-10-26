<template>
  <div class="stats-card" :style="borderLeft ? { borderLeft: `4px solid ${borderLeft}` } : {}">
    <div class="stats-icon" :style="iconBg ? { background: iconBg } : {}" v-if="icon"><AppIcon :name="icon" :size="20" /></div>
    <div class="stats-content">
      <div class="stats-value">{{ value }}</div>
      <div class="stats-label">{{ label }}</div>
      <div class="stats-change" :class="changeType" v-if="change">{{ change }}</div>
    </div>
  </div>
</template>

<script>
import AppIcon from './AppIcon.vue'

export default {
  name: 'StatsCard',
  components: { AppIcon },
  props: {
    icon: { type: String, default: '' },
    iconBg: { type: String, default: '' },
    value: { type: [String, Number], default: 0 },
    label: { type: String, default: '' },
    change: { type: String, default: '' },
    changeType: { type: String, default: '' },
    borderLeft: { type: String, default: '' }
  }
}
</script>
