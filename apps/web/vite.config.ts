import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { cspMetaPlugin } from './src/build/csp';

export default defineConfig(({ mode }) => {
  // loadEnv also reads the VITE_ variables Vercel sets in the process environment.
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [
      react(),
      tailwindcss(),
      cspMetaPlugin({ apiUrl: env.VITE_API_URL, supabaseUrl: env.VITE_SUPABASE_URL }),
    ],
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['src/test/setup.ts'],
    },
  };
});
