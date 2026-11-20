// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/ui'],

  devtools: {
    enabled: false
  },

  runtimeConfig: {
    wiremockBaseUrl: 'http://localhost:8080',
    wiremockAuthToken: '',
    wiremockUsername: '',
    wiremockPassword: ''
  },

  fonts: {
    providers: {
      google: false,
      bunny: false,
      fontshare: false,
      fontsource: false
    }
  },

  css: ['~/assets/css/main.css'],

  ui: {
    eslint: {
      rules: {
        'no-unknown-classes': 'error',
        'no-conflicting-classes': 'error',
        'no-palette-colors': 'error'
      }
    }
  },

  compatibilityDate: '2026-06-30',

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
