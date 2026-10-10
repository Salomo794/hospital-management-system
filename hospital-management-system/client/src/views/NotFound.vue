<template>
  <main class="not-found-page">
    <div class="not-found-card">
      <div class="error-code">404</div>
      <h1>Page not found</h1>
      <p>The page you requested does not exist or may have been moved.</p>
      <router-link to="/dashboard" class="btn btn-primary">Return to dashboard</router-link>
    </div>
  </main>
</template>

<script>
export default { name: 'NotFound' }
</script>

<style scoped>
.not-found-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  background: var(--gray-50);
}
.not-found-card {
  max-width: 460px;
  padding: 40px;
  text-align: center;
  background: var(--white);
  border: 1px solid var(--gray-200);
  border-radius: 16px;
  box-shadow: var(--shadow-md);
}
.error-code {
  font-size: 72px;
  font-weight: 800;
  color: var(--primary-600);
}
h1 { margin: 8px 0; color: var(--gray-900); }
p { margin: 0 0 24px; color: var(--gray-600); }
</style>
