import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Клиент ходит на относительный /api, прокси уводит запросы на Express.
    // Так в браузере нет CORS и адрес сервера не зашит в код.
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
