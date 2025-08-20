#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

// 检查关键依赖
const requiredDeps = ['electron', 'marked', 'highlight.js', 'html-to-image', 'codemirror'];

const missing = requiredDeps.filter(dep => {
  try {
    require.resolve(dep);
    return false;
  } catch (error) {
    return true;
  }
});

if (missing.length > 0) {
  console.log(`缺少依赖: ${missing.join(', ')}`);
  console.log('正在安装依赖，请稍候...');
  
  // 构建安装命令，直接安装指定版本的包
  const installMap = {
    'html-to-image': 'html-to-image@^1.11.13',
    'electron': 'electron@^37.2.3',
    'marked': 'marked@^5.0.0',
    'highlight.js': 'highlight.js@^11.11.1',
    'codemirror': 'codemirror@^6.0.2'
  };
  
  const packagesToInstall = missing.map(dep => installMap[dep] || dep);
  const installCmd = `npm install ${packagesToInstall.join(' ')}`;
  
  try {
    execSync(installCmd, { 
      stdio: ['inherit', 'pipe', 'inherit'], 
      cwd: __dirname 
    });
    console.log('依赖安装完成！');
  } catch (error) {
    console.error('依赖安装失败:', error.message);
    process.exit(1);
  }
}