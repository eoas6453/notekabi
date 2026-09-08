import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * 移除 script 标签上的 type="module" / crossorigin
 * 原因：Electron 以 file:// 加载页面时，module 脚本与 crossorigin 会被 CORS 拦截，
 * 打成 IIFE 后必须还原成普通脚本才能正常执行。
 */
function plainScript(): Plugin {
  return {
    name: 'plain-script',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return (
          html
            // 还原成普通脚本，并加 defer：vite 会把脚本注入 head，
            // 普通脚本会先于 DOM 执行，导致 React 找不到 #root
            .replace(/<script[^>]*\ssrc="([^"]+)"[^>]*>/g, (m, src) =>
              m.includes('defer') ? m : `<script defer src="${src}">`,
            )
            .replace(/<link rel="modulepreload"[^>]*>/g, '')
        )
      },
    },
  }
}

// 打包为相对路径资源，保证 Electron 用 file:// 加载时也能正常工作
export default defineConfig({
  base: './',
  plugins: [react(), plainScript()],
  build: {
    outDir: 'dist',
    emptyOutDir: false, // 固定文件名会直接覆盖，清空目录反而容易触发安全策略
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    // Electron 以 file:// 加载页面，ES module 会被 CORS 拦截，
    // 因此打成 IIFE 单文件，保证双击即可运行
    modulePreload: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        format: 'iife',
        entryFileNames: 'assets/app.js',
        assetFileNames: 'assets/app[extname]',
      },
    },
  },
  server: {
    port: 5173,
    host: '127.0.0.1',
  },
})
