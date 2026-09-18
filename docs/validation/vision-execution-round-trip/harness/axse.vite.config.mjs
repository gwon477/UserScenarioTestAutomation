import { defineConfig } from '/Users/a11769/Desktop/master-project/test_project_source/axse-agents/frontend/node_modules/vite/dist/node/index.js'
import react from '/Users/a11769/Desktop/master-project/test_project_source/axse-agents/frontend/node_modules/@vitejs/plugin-react/dist/index.js'

export default defineConfig({
  root: '/Users/a11769/Desktop/master-project/test_project_source/axse-agents/frontend',
  cacheDir: '/private/tmp/claude-501/-Users-a11769-Desktop-master-project/3be9d6a8-cb44-45ee-8a70-a8f40f140ddc/scratchpad/grounding/.vite',
  plugins: [react()],
  server: {
    port: 45180,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:45181' },
  },
})
