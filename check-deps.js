#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

// 检查关键依赖
const requiredDeps = [
  'electron', 
  'marked', 
  'highlight.js', 
  'html2canvas', 
  'codemirror',
  '@codemirror/lang-markdown',
  '@codemirror/search',
  '@codemirror/state',
  '@codemirror/view',
  '@codemirror/commands',
  '@codemirror/lang-cpp',
  '@codemirror/lang-css',
  '@codemirror/lang-html',
  '@codemirror/lang-java',
  '@codemirror/lang-javascript',
  '@codemirror/lang-json',
  '@codemirror/lang-python',
  '@codemirror/lang-sql',
  '@codemirror/lang-xml',
  '@codemirror/language',
  '@lezer/common'
];

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
    'html2canvas': 'html2canvas@^1.4.1',
    'electron': 'electron@^37.2.3',
    'marked': 'marked@^5.0.0',
    'highlight.js': 'highlight.js@^11.11.1',
    'codemirror': 'codemirror@^6.0.2',
    '@codemirror/lang-markdown': '@codemirror/lang-markdown@^6.3.3',
    '@codemirror/search': '@codemirror/search@^6.5.11',
    '@codemirror/state': '@codemirror/state@^6.5.2',
    '@codemirror/view': '@codemirror/view@^6.38.1',
    '@codemirror/commands': '@codemirror/commands@^6.8.1',
    '@codemirror/lang-cpp': '@codemirror/lang-cpp@^6.0.3',
    '@codemirror/lang-css': '@codemirror/lang-css@^6.3.1',
    '@codemirror/lang-html': '@codemirror/lang-html@^6.4.9',
    '@codemirror/lang-java': '@codemirror/lang-java@^6.0.2',
    '@codemirror/lang-javascript': '@codemirror/lang-javascript@^6.2.4',
    '@codemirror/lang-json': '@codemirror/lang-json@^6.0.2',
    '@codemirror/lang-python': '@codemirror/lang-python@^6.2.1',
    '@codemirror/lang-sql': '@codemirror/lang-sql@^6.9.1',
    '@codemirror/lang-xml': '@codemirror/lang-xml@^6.1.0',
    '@codemirror/language': '@codemirror/language@^6.11.3',
    '@lezer/common': '@lezer/common@^1.2.3'
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