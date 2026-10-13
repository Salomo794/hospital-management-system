(function () {
  try {
    document.documentElement.setAttribute(
      'data-theme',
      window.localStorage.getItem('theme-dark') === '1' ? 'dark' : 'light'
    )
  } catch (_) {
    document.documentElement.setAttribute('data-theme', 'light')
  }
})()
