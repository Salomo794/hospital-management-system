<template>
  <div class="loading-page" v-if="fullpage">
    <div class="loading-spinner lg"></div>
    <p v-if="text">{{ text }}</p>
  </div>
  <div class="loading-inline" v-else>
    <div class="loading-spinner" :class="size"></div>
    <span v-if="text" class="loading-text">{{ text }}</span>
  </div>
</template>

<script>
export default {
  name: 'LoadingSpinner',
  props: {
    text: { type: String, default: '' },
    fullpage: { type: Boolean, default: false },
    size: { type: String, default: '' }
  }
}
</script>

<style scoped>
.loading-inline {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.loading-text {
  font-size: 14px;
  color: var(--text-muted);
}
</style>
