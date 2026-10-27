import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Local dev: /api is proxied to the Python API on :9000. On OpenShift nginx does it.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:9000' } }
})
