#!/usr/bin/env node

/**
 * Mac App Store 版本构建脚本
 * 构建用于 App Store 提交的版本
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 开始构建 Mac App Store 版本...');
console.log('目标：macOS MAS (Universal Binary)');
console.log('用途：提交到 Mac App Store');
console.log('注意：需要配置 App Store 签名证书和 Provisioning Profile');

const setupScript = path.join(__dirname, 'setup-build-env.js');

const buildProcess = spawn('node', [setupScript, '--mac', 'mas', '--universal'], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
});

buildProcess.on('close', (code) => {
    if (code === 0) {
        console.log('✅ Mac App Store 版本构建完成！');
        console.log('📦 构建产物位于: dist/');
        console.log('📝 接下来可以使用以下命令进行公证和提交：');
        console.log('   xcrun notarytool submit dist/mas-universal/Mark2-*.pkg \\');
        console.log('     --apple-id "your-apple-id" \\');
        console.log('     --password "app-specific-password" \\');
        console.log('     --team-id "$APPLE_TEAM_ID" \\');
        console.log('     --wait --verbose');
    } else {
        console.log('❌ Mac App Store 构建失败，退出码:', code);
        process.exit(code);
    }
});

buildProcess.on('error', (error) => {
    console.error('❌ 启动构建进程失败:', error);
    process.exit(1);
});