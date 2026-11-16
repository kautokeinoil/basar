import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serverer appen fra /basar/
export default defineConfig({
  base: '/basar/',
  plugins: [react()],
});
