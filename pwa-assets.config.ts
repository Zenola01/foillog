import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Generates the app icons in public/ from public/logo.svg: npx pwa-assets-generator
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, padding: 0.3, resizeOptions: { background: '#0a0d0f' } },
    apple: { ...minimal2023Preset.apple, padding: 0.3, resizeOptions: { background: '#0a0d0f' } },
  },
  images: ['public/logo.svg'],
})
