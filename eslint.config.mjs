// @ts-check
import { readFileSync } from 'node:fs'
import withNuxt from './.nuxt/eslint.config.mjs'

// Recognize the app's global CSS classes without changing their cascade priority.
const stylesheet = readFileSync(
  new URL('./app/assets/css/main.css', import.meta.url),
  'utf8'
)
const declaredClasses = [...new Set(
  [...stylesheet.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.([a-zA-Z_][\w-]*)(?=[^{};]*\{)/g)]
    .map(([, name]) => `^${name}$`)
)]

export default withNuxt(
  { ignores: ['.agents/**'] },
  {
    settings: {
      'better-tailwindcss': {
        detectComponentClasses: true
      }
    },
    rules: {
      'better-tailwindcss/no-unknown-classes': ['error', { ignore: declaredClasses }]
    }
  }
)
