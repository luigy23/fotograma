import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  // Se cargan bajo demanda; pre-optimizarlas evita que el servidor de desarrollo recargue la página.
  optimizeDeps: { include: ['fflate', 'react-dom/server', 'lottie-web/build/player/lottie_light', 'ajv/dist/2020', '@lottie-animation-community/lottie-specs'] },
  test: {
    environment: 'jsdom',
  },
} as never);
