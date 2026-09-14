import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    // SMB 共享盘的变更通知不稳定；仅在手动测试时关闭前端监听。
    watch: process.env.MARK2_DISABLE_FILE_WATCH === '1'
      ? null
      : {
          // Tauri 的本地构建产物不属于前端源码，也不应被监听。
          ignored: ['**/src-tauri/target/**'],
        },
  },
  // 应用只有一个 HTML 入口；避免把测试夹具和 Tauri 生成的 HTML 当成页面扫描。
  optimizeDeps: {
    entries: ['index.html'],
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: ['es2021', 'chrome100', 'safari13'],
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    // Monaco 相关 worker 体积较大，放宽告警阈值避免每次构建出现噪声。
    chunkSizeWarningLimit: 7000,
  },
});
