#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
  log(`\n[${step}] ${message}`, 'blue');
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

// 读取 package.json
function getPackageVersion() {
  const packagePath = path.join(__dirname, 'package.json');
  const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  return packageData.version;
}

// 检查环境变量
function checkEnvironment() {
  logStep('1', '检查环境配置');
  
  const required = ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_IDENTITY'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    logError(`缺少环境变量: ${missing.join(', ')}`);
    logWarning('请确保 .env 文件包含以下内容:');
    console.log('APPLE_ID="your@email.com"');
    console.log('APPLE_PASSWORD="your-app-specific-password"');
    console.log('APPLE_IDENTITY="Your Name (TEAM_ID)"');
    process.exit(1);
  }
  
  logSuccess('环境配置检查通过');
}

// 清理构建目录
function cleanBuild() {
  logStep('2', '清理构建目录');
  
  try {
    execSync('rm -rf dist/mas-*', { stdio: 'pipe' });
    logSuccess('构建目录已清理');
  } catch (error) {
    logWarning('清理构建目录时出现警告（可忽略）');
  }
}

// 检查依赖
function checkDependencies() {
  logStep('3', '检查依赖');
  
  try {
    execSync('node check-deps.js', { stdio: 'pipe' });
    logSuccess('依赖检查完成');
  } catch (error) {
    logError('依赖检查失败');
    throw error;
  }
}

// 构建 MAS 版本
function buildMAS() {
  logStep('4', '构建 Mac App Store 版本');
  
  try {
    log('正在构建 Universal Binary (x64 + arm64)...', 'cyan');
    execSync('npx electron-builder --mac mas --universal', { 
      stdio: ['pipe', 'pipe', 'inherit'],
      timeout: 300000 // 5 分钟超时
    });
    logSuccess('MAS 应用构建完成');
  } catch (error) {
    logError('MAS 应用构建失败');
    throw error;
  }
}

// 生成 PKG 文件
function generatePKG() {
  logStep('5', '生成签名的 PKG 文件');
  
  const version = getPackageVersion();
  const appPath = 'dist/mas-universal/Mark2.app';
  const pkgPath = `dist/mas-universal/Mark2-${version}-universal.pkg`;
  
  // 检查应用是否存在
  if (!fs.existsSync(appPath)) {
    logError(`应用文件不存在: ${appPath}`);
    throw new Error('应用构建失败');
  }
  
  try {
    const identity = process.env.APPLE_IDENTITY || 'YOUR_IDENTITY_NAME (TEAM_ID)';
    const cmd = `productbuild --component "${appPath}" /Applications --sign "${identity}" "${pkgPath}"`;
    execSync(cmd, { stdio: 'inherit' });
    logSuccess(`PKG 文件生成: ${pkgPath}`);
    return pkgPath;
  } catch (error) {
    logError('PKG 文件生成失败');
    throw error;
  }
}

// 验证构建结果
function validateBuild(pkgPath) {
  logStep('6', '验证构建结果');
  
  try {
    // 检查文件大小
    const stats = fs.statSync(pkgPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
    log(`PKG 文件大小: ${sizeMB}MB`, 'cyan');
    
    if (stats.size < 1024 * 1024) { // 小于 1MB
      logWarning('PKG 文件似乎过小，请检查构建是否正确');
    }
    
    // 验证应用签名
    execSync('codesign --display --verbose dist/mas-universal/Mark2.app', { stdio: 'pipe' });
    
    logSuccess('构建结果验证通过');
    return true;
  } catch (error) {
    logError('构建结果验证失败');
    throw error;
  }
}

// 上传到 App Store Connect
function uploadToAppStore(pkgPath) {
  logStep('7', '上传到 App Store Connect');
  
  const { APPLE_ID, APPLE_PASSWORD } = process.env;
  
  try {
    log('正在上传，请稍候...', 'cyan');
    const cmd = `xcrun altool --upload-app --type osx --file "${pkgPath}" --username "${APPLE_ID}" --password "${APPLE_PASSWORD}"`;
    
    const output = execSync(cmd, { 
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 180000 // 3 分钟超时
    });
    
    // 输出完整信息供调试
    console.log('altool output:', output);
    
    // 解析上传结果 - 兼容新旧版本的 altool 输出格式
    const isSuccess = output.includes('UPLOAD SUCCEEDED') || output.includes('No errors uploading');
    
    if (isSuccess) {
      // 提取 UUID（旧版本格式）
      const uuidMatch = output.match(/Delivery UUID: ([a-f0-9-]+)/);
      const uuid = uuidMatch ? uuidMatch[1] : '未知';
      
      logSuccess('上传成功！');
      if (uuid !== '未知') {
        log(`Delivery UUID: ${uuid}`, 'cyan');
      }
      
      // 提取传输信息（旧版本格式）
      const transferMatch = output.match(/Transferred (\d+) bytes in ([\d.]+) seconds/);
      if (transferMatch) {
        const bytes = parseInt(transferMatch[1]);
        const seconds = parseFloat(transferMatch[2]);
        const sizeMB = (bytes / 1024 / 1024).toFixed(1);
        const speedMBs = (bytes / 1024 / 1024 / seconds).toFixed(1);
        log(`传输信息: ${sizeMB}MB 在 ${seconds}s 内完成 (${speedMBs}MB/s)`, 'cyan');
      } else if (output.includes('No errors uploading')) {
        // 新版本格式的简化反馈
        log('上传已完成，请前往 App Store Connect 查看处理状态', 'cyan');
      }
      
      return uuid;
    } else {
      // 上传失败，输出详细信息用于调试
      logError('altool 上传失败，完整输出：');
      console.log(output);
      throw new Error('上传失败');
    }
  } catch (error) {
    logError('上传到 App Store Connect 失败');
    if (error.message.includes('timeout')) {
      logWarning('上传超时，但可能仍在后台进行，请检查 App Store Connect');
    }
    throw error;
  }
}

// 主函数
async function main() {
  const startTime = Date.now();
  
  log('🚀 Mark2 Mac App Store 构建和上传工具', 'cyan');
  log(`版本: ${getPackageVersion()}`, 'cyan');
  log('='*50, 'cyan');
  
  try {
    checkEnvironment();
    cleanBuild();
    checkDependencies();
    buildMAS();
    const pkgPath = generatePKG();
    validateBuild(pkgPath);
    const uuid = uploadToAppStore(pkgPath);
    
    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    
    log('\n' + '='*50, 'green');
    logSuccess('🎉 MAS 构建和上传完成！');
    log(`⏱️  总耗时: ${duration} 分钟`, 'cyan');
    log(`📦 PKG 文件: ${pkgPath}`, 'cyan');
    log(`🔗 Delivery UUID: ${uuid}`, 'cyan');
    log('\n📱 请前往 App Store Connect 查看构建状态:', 'yellow');
    log('https://appstoreconnect.apple.com', 'blue');
    
  } catch (error) {
    logError('\n构建或上传过程中出现错误:');
    console.error(error.message);
    
    log('\n🔧 故障排除建议:', 'yellow');
    log('1. 检查网络连接');
    log('2. 确认开发者证书有效');
    log('3. 验证 .env 文件中的 Apple ID 和密码');
    log('4. 查看上方的详细错误信息');
    
    process.exit(1);
  }
}

// 运行主函数
if (require.main === module) {
  main();
}

module.exports = { main };