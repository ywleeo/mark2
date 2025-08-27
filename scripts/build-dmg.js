#!/usr/bin/env node

/**
 * DMG 分发版本构建脚本
 * 构建用于直接分发的 .dmg 文件
 */

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 开始构建 DMG 分发版本...');
console.log('目标：macOS DMG (Universal Binary)');
console.log('用途：直接分发给用户，无需 App Store 审核');

const setupScript = path.join(__dirname, 'setup-build-env.js');

const buildProcess = spawn('node', [setupScript, '--mac', 'dmg', '--universal'], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
});

buildProcess.on('close', (code) => {
    if (code === 0) {
        console.log('✅ DMG 分发版本构建完成！');
        console.log('📦 构建产物位于: dist/');
        console.log('📝 可直接分发给用户安装');
    } else {
        console.log('❌ DMG 构建失败，退出码:', code);
        process.exit(code);
    }
});

buildProcess.on('error', (error) => {
    console.error('❌ 启动构建进程失败:', error);
    process.exit(1);
});