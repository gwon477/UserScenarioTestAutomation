import { fileURLToPath } from 'node:url'
import tailwindcss from '/Users/a11769/Desktop/RA-DAR/FrontEnd/node_modules/@tailwindcss/vite/dist/index.mjs'
import react from '/Users/a11769/Desktop/RA-DAR/FrontEnd/node_modules/@vitejs/plugin-react/dist/index.js'
import { defineConfig } from '/Users/a11769/Desktop/RA-DAR/FrontEnd/node_modules/vite/dist/node/index.js'

export default defineConfig({
  root: '/Users/a11769/Desktop/RA-DAR/FrontEnd',
  cacheDir: '/private/tmp/claude-501/-Users-a11769-Desktop-master-project/3be9d6a8-cb44-45ee-8a70-a8f40f140ddc/scratchpad/grounding/.vite-radar',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': '/Users/a11769/Desktop/RA-DAR/FrontEnd/src' } },
  server: {
    port: 45190,
    strictPort: true,
    proxy: { '/api': { target: 'http://127.0.0.1:45191', changeOrigin: true } },
  },
})
