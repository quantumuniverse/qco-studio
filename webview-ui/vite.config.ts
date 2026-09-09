import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * 产物固定输出为 out/webview/index.js 与 out/webview/index.css，
 * 方便 extension 端通过 asWebviewUri 直接引用固定文件名。
 */
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: fileURLToPath(new URL('../out/webview/', import.meta.url)),
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: fileURLToPath(new URL('index.html', import.meta.url)),
      output: {
        entryFileNames: 'index.js',
        assetFileNames: 'index.[ext]',
        chunkFileNames: 'chunks/[name].js'
      }
    }
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('src', import.meta.url))
    }
  },
  server: {
    port: 5173
  }
});
