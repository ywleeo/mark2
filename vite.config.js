import { defineConfig } from 'vite';

// 渠道由构建入口传递，避免未知值意外退回功能更宽的发行版。
const distribution = process.env.MARK2_DISTRIBUTION || 'github';
if (!['github', 'mas'].includes(distribution)) throw new Error('无效的 MARK2_DISTRIBUTION');
const privacyPolicyUrl = process.env.MARK2_PRIVACY_POLICY_URL || '';
if (privacyPolicyUrl && new URL(privacyPolicyUrl).protocol !== 'https:') throw new Error('隐私政策必须使用 HTTPS');

export default defineConfig({
  define: {
    __MARK2_DISTRIBUTION__: JSON.stringify(distribution),
    __MARK2_PRIVACY_POLICY_URL__: JSON.stringify(privacyPolicyUrl),
  },
  plugins: [{
    name: 'mark2-distribution-proof',
    /** 构建后检查真实模块图，禁止 MAS 产物夹带站外更新实现。 */
    generateBundle(_options, bundle) {
      const moduleIds = Object.values(bundle).flatMap(chunk => chunk.type === 'chunk' ? Object.keys(chunk.modules) : []);
      const updaterIncluded = moduleIds.some(id => /(?:\/modules\/autoUpdater\.js|\/@tauri-apps\/plugin-(?:updater|process)\/)/.test(id));
      const storeKitSubscriptions = moduleIds.some(id => id.endsWith('/subscriptions/subscriptionController.js'));
      if (distribution === 'mas' && updaterIncluded) this.error('MAS 前端包含站外更新模块，停止打包');
      if (storeKitSubscriptions) this.error('买断版不得包含订阅控制器，停止打包');
      this.emitFile({ type: 'asset', fileName: 'distribution.json', source: JSON.stringify({
        channel: distribution, desktopUpdaterIncluded: updaterIncluded, storeKitSubscriptions, privacyPolicyUrl: privacyPolicyUrl || null,
      }, null, 2) });
    },
  }],
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
    outDir: distribution === 'mas' ? 'dist-mas' : 'dist',
    target: ['es2021', 'chrome100', 'safari13'],
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    // Monaco 相关 worker 体积较大，放宽告警阈值避免每次构建出现噪声。
    chunkSizeWarningLimit: 7000,
  },
});
