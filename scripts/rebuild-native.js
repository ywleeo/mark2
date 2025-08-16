#!/usr/bin/env node

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('重新构建原生模块...');

// 获取 Electron 版本
const electronVersion = require('../package.json').devDependencies.electron.replace('^', '');
console.log(`Electron 版本: ${electronVersion}`);

// 重新安装 Sharp 并为 Electron 环境构建
const commands = [
  'npm rebuild sharp --update-binary',
  `npx electron-rebuild -v ${electronVersion} -m . -w sharp`
];

async function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    console.log(`执行: ${cmd}`);
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        console.error(`错误: ${error.message}`);
        reject(error);
        return;
      }
      if (stderr) {
        console.warn(`警告: ${stderr}`);
      }
      if (stdout) {
        console.log(stdout);
      }
      resolve();
    });
  });
}

async function rebuildNative() {
  try {
    for (const cmd of commands) {
      await runCommand(cmd);
    }
    console.log('原生模块重新构建完成');
  } catch (error) {
    console.error('重新构建失败:', error);
    process.exit(1);
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  rebuildNative();
}

module.exports = rebuildNative;