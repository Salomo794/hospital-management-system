<template>
  <div class="stats-card" :style="borderLeft ? { borderLeft: `4px solid ${borderLeft}` } : {}">
    <div class="stats-icon" :style="{ background: iconBg }" v-if="iconBg">{{ icon }}</div>
    <div class="stats-content">
      <div class="stats-value">{{ value }}</div>
      <div class="stats-label">{{ label }}</div>
      <div class="stats-change" :class="changeType" v-if="change">{{ change }}</div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'StatsCard',
  props: {
    icon: { type: String, default: '' },
    iconBg: { type: String, default: 'var(--brand-50)' },
    value: { type: [String, Number], default: 0 },
    label: { type: String, default: '' },
    change: { type: String, default: '' },
    changeType: { type: String, default: '' },
    borderLeft: { type: String, default: '' }
  }
}
</script>
