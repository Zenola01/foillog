import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Generates the app icons in public/ from public/logo.svg: npx pwa-assets-generator
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, padding: 0.3, resizeOptions: { background: '#0d3b52' } },
    apple: { ...minimal2023Preset.apple, padding: 0.3, resizeOptions: { background: '#0d3b52' } },
  },
  images: ['public/logo.svg'],
})
