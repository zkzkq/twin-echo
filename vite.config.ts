import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // 5173 落在 Windows 保留端口区（5134-5233），改用 4173
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: { target: 'es2022' },
});
