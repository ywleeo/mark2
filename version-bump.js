#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// 解析版本号
function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!match) {
    throw new Error(`无效的版本号格式: ${version}`);
  }
  
  return {
    major: parseInt(match[1]),
    minor: parseInt(match[2]),
    patch: parseInt(match[3]),
    prerelease: match[4] || null,
    toString() {
      const base = `${this.major}.${this.minor}.${this.patch}`;
      return this.prerelease ? `${base}-${this.prerelease}` : base;
    }
  };
}

// 升级版本号
function bumpVersion(currentVersion, type) {
  const version = parseVersion(currentVersion);
  
  switch (type) {
    case 'major':
      version.major++;
      version.minor = 0;
      version.patch = 0;
      version.prerelease = null;
      break;
    case 'minor':
      version.minor++;
      version.patch = 0;
      version.prerelease = null;
      break;
    case 'patch':
      version.patch++;
      version.prerelease = null;
      break;
    case 'prerelease':
      if (version.prerelease) {
        // 如果已经是预发布版本，增加预发布版本号
        const match = version.prerelease.match(/^(.+?)\.?(\d+)$/);
        if (match) {
          const num = parseInt(match[2] || 0) + 1;
          version.prerelease = `${match[1]}.${num}`;
        } else {
          version.prerelease += '.1';
        }
      } else {
        // 如果不是预发布版本，创建预发布版本
        version.patch++;
        version.prerelease = 'beta.0';
      }
      break;
    default:
      // 如果 type 是具体的版本号，直接设置
      if (/^\d+\.\d+\.\d+/.test(type)) {
        return parseVersion(type);
      }
      throw new Error(`不支持的版本升级类型: ${type}`);
  }
  
  return version;
}

// 更新 package.json
function updatePackageJson(newVersion) {
  const packagePath = path.join(__dirname, 'package.json');
  const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  
  const oldVersion = packageData.version;
  packageData.version = newVersion.toString();
  
  fs.writeFileSync(packagePath, JSON.stringify(packageData, null, 2) + '\n');
  
  return { oldVersion, newVersion: newVersion.toString() };
}

// 显示帮助信息
function showHelp() {
  log('📦 Mark2 版本管理工具\n', 'cyan');
  log('用法:', 'blue');
  log('  node version-bump.js <type>');
  log('  npm run version:<type>\n');
  
  log('版本升级类型:', 'blue');
  log('  patch      - 补丁版本 (1.0.0 → 1.0.1)');
  log('  minor      - 次版本   (1.0.1 → 1.1.0)');
  log('  major      - 主版本   (1.1.0 → 2.0.0)');
  log('  prerelease - 预发布   (1.0.0 → 1.0.1-beta.0)\n');
  
  log('直接指定版本:', 'blue');
  log('  node version-bump.js 1.5.0');
  log('  node version-bump.js 2.0.0-beta.1\n');
  
  log('示例:', 'blue');
  log('  npm run version:patch    # 修复 bug');
  log('  npm run version:minor    # 新功能');
  log('  npm run version:major    # 重大更新');
}

// 主函数
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showHelp();
    return;
  }
  
  const type = args[0];
  
  try {
    // 读取当前版本
    const packagePath = path.join(__dirname, 'package.json');
    const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const currentVersion = packageData.version;
    
    log(`当前版本: ${currentVersion}`, 'cyan');
    
    // 计算新版本
    const newVersion = bumpVersion(currentVersion, type);
    
    // 更新 package.json
    const result = updatePackageJson(newVersion);
    
    log(`新版本: ${result.newVersion}`, 'green');
    log('\n✅ 版本号更新完成！', 'green');
    
    // 显示后续步骤
    log('\n📋 后续步骤:', 'blue');
    log('1. 运行测试确保应用正常工作');
    log('2. 提交版本变更: git add package.json && git commit -m "bump version to v' + result.newVersion + '"');
    log('3. 构建和上传: npm run build:mas:upload');
    
  } catch (error) {
    log(`❌ 错误: ${error.message}`, 'red');
    process.exit(1);
  }
}

// 运行主函数
if (require.main === module) {
  main();
}

module.exports = { bumpVersion, parseVersion };