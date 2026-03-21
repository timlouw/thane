import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    port: 4200,
    strictPort: false,
  },
  preview: {
    port: 4200,
    strictPort: false,
  },
  plugins: [react()],
  envPrefix: 'REACT_APP_',
  envDir: './environments',
});
