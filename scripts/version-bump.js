#!/usr/bin/env node

/**
 * 版本号升级脚本
 * 使用方法：
 * node scripts/version-bump.js patch  # 1.2.3 -> 1.2.4
 * node scripts/version-bump.js minor  # 1.2.3 -> 1.3.0
 * node scripts/version-bump.js major  # 1.2.3 -> 2.0.0
 * node scripts/version-bump.js 1.4.0  # 直接设置版本号
 */

const fs = require('fs');
const path = require('path');

// 颜色输出
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function parseVersion(version) {
    const parts = version.split('.').map(Number);
    if (parts.length !== 3 || parts.some(isNaN)) {
        throw new Error(`无效的版本号格式: ${version}`);
    }
    return { major: parts[0], minor: parts[1], patch: parts[2] };
}

function bumpVersion(version, type) {
    const v = parseVersion(version);
    
    switch (type) {
        case 'major':
            return `${v.major + 1}.0.0`;
        case 'minor':
            return `${v.major}.${v.minor + 1}.0`;
        case 'patch':
            return `${v.major}.${v.minor}.${v.patch + 1}`;
        default:
            // 检查是否是直接的版本号
            if (/^\d+\.\d+\.\d+$/.test(type)) {
                return type;
            }
            throw new Error(`无效的升级类型: ${type}。支持 major/minor/patch 或直接指定版本号`);
    }
}

async function main() {
    try {
        const args = process.argv.slice(2);
        if (args.length === 0) {
            log('使用方法:', 'yellow');
            log('  node scripts/version-bump.js patch  # 补丁版本 (1.2.3 -> 1.2.4)', 'cyan');
            log('  node scripts/version-bump.js minor  # 次版本 (1.2.3 -> 1.3.0)', 'cyan');
            log('  node scripts/version-bump.js major  # 主版本 (1.2.3 -> 2.0.0)', 'cyan');
            log('  node scripts/version-bump.js 1.4.0  # 直接设置版本号', 'cyan');
            return;
        }

        const bumpType = args[0];
        const packageJsonPath = path.join(__dirname, '..', 'package.json');
        
        if (!fs.existsSync(packageJsonPath)) {
            throw new Error(`package.json 文件不存在: ${packageJsonPath}`);
        }

        // 读取当前版本
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const currentVersion = packageJson.version;
        
        // 计算新版本
        const newVersion = bumpVersion(currentVersion, bumpType);
        
        log('🔄 版本号升级', 'blue');
        log(`当前版本: ${currentVersion}`, 'yellow');
        log(`新版本: ${newVersion}`, 'green');
        
        // 更新 package.json
        packageJson.version = newVersion;
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
        
        log('✅ 版本号升级完成！', 'bright');
        log(`📦 现在可以运行: npm run build-upload:mas`, 'cyan');
        
    } catch (error) {
        log(`❌ 版本升级失败: ${error.message}`, 'red');
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { bumpVersion, parseVersion };