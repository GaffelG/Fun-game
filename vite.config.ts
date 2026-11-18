/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  // `npm test` runs unit tests; `npm run balance` simulates 60 games to check difficulty and match length.
  test: { include: process.env.BALANCE ? ['scripts/**/*.test.ts'] : ['src/**/*.test.ts'] },
});
