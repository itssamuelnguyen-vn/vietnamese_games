import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // In dev, forward socket traffic to the Node server on port 3000.
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
