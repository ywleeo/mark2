#!/usr/bin/env node

/**
 * 修复 MAS 构建脚本
 * 删除 Login Helper 并重新签名（用于构建后的修复）
 */

const { exec } = require('child_process');
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

function execCommand(command, description) {
    return new Promise((resolve, reject) => {
        log(`🔄 ${description}`, 'blue');
        log(`执行: ${command}`, 'cyan');
        
        exec(command, (error, stdout, stderr) => {
            if (error) {
                log(`❌ ${description}失败: ${error.message}`, 'red');
                reject(error);
                return;
            }
            
            if (stderr && !stderr.includes('replacing existing signature')) {
                log(`⚠️  警告: ${stderr}`, 'yellow');
            }
            
            if (stdout.trim()) {
                log(`${stdout.trim()}`, 'green');
            }
            
            log(`✅ ${description}完成`, 'green');
            resolve(stdout);
        });
    });
}

async function fixMASBuild() {
    try {
        log('🔧 开始修复 MAS 构建...', 'bright');
        
        const appPath = 'dist/mas-universal/Mark2.app';
        const libraryPath = `${appPath}/Contents/Library`;
        
        // 检查应用包是否存在
        if (!fs.existsSync(appPath)) {
            throw new Error(`应用包不存在: ${appPath}\n请先运行: npm run build:mas`);
        }
        
        log('✅ 找到应用包', 'green');
        
        // 检查 Library 目录
        if (fs.existsSync(libraryPath)) {
            log('🗑️  删除 Login Helper 组件...', 'yellow');
            await execCommand(`rm -rf "${libraryPath}"`, '删除 Library 目录');
            
            if (fs.existsSync(libraryPath)) {
                throw new Error('Library 目录删除失败');
            }
            log('✅ Login Helper 已删除', 'green');
        } else {
            log('✅ Library 目录不存在，无需删除', 'green');
        }
        
        // 删除所有 Helper 进程
        log('🗑️  删除所有 Helper 进程...', 'blue');
        const frameworksPath = `${appPath}/Contents/Frameworks`;
        const helperPatterns = [
            'Mark2 Helper.app',
            'Mark2 Helper (Plugin).app',
            'Mark2 Helper (Renderer).app',
            'Mark2 Helper (GPU).app'
        ];
        
        for (const helperPattern of helperPatterns) {
            const helperPath = `${frameworksPath}/${helperPattern}`;
            if (fs.existsSync(helperPath)) {
                await execCommand(`rm -rf "${helperPath}"`, `删除 ${helperPattern}`);
                log(`✅ ${helperPattern} 已删除`, 'green');
            }
        }
        
        // 重新签名主应用
        log('✍️  重新签名主应用...', 'blue');
        const signIdentity = '3rd Party Mac Developer Application: yuwei li (YH83TRKYT7)';
        const entitlementsPath = path.join(__dirname, '..', 'entitlements.mas.plist');
        
        // 签名主应用（使用主 entitlements）
        await execCommand(
            `codesign --force --sign "${signIdentity}" --entitlements "${entitlementsPath}" "${appPath}"`, 
            '主应用签名'
        );
        
        // 验证签名
        log('🔐 验证签名...', 'blue');
        await execCommand(`codesign --verify --verbose "${appPath}"`, '签名验证');
        
        // 重新生成 .pkg 文件
        log('📦 重新生成 .pkg 文件...', 'blue');
        
        // 从 package.json 读取版本号
        const packageJsonPath = path.join(__dirname, '..', 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const version = packageJson.version;
        const pkgPath = `dist/mas-universal/Mark2-${version}-universal.pkg`;
        
        log(`📋 当前版本: ${version}`, 'cyan');
        
        // 删除旧的 .pkg 文件
        await execCommand(`rm -f "${pkgPath}"`, '删除旧的 .pkg 文件');
        
        // 使用 productbuild 重新生成 .pkg
        const installerIdentity = '3rd Party Mac Developer Installer: yuwei li (YH83TRKYT7)';
        await execCommand(
            `productbuild --component "${appPath}" /Applications --sign "${installerIdentity}" "${pkgPath}"`,
            '重新生成 .pkg 文件'
        );
        
        // 验证新的 .pkg 文件不包含 Library
        log('🔍 验证新 .pkg 文件...', 'blue');
        await execCommand(
            `pkgutil --payload-files "${pkgPath}" | grep -i library || echo "✅ 未发现 Library 目录"`,
            '检查 .pkg 文件内容'
        );
        
        log('🎉 MAS 构建修复完成！', 'bright');
        log('📦 新的 .pkg 文件已生成，可以安全上传到 App Store', 'green');
        
    } catch (error) {
        log(`❌ 修复失败: ${error.message}`, 'red');
        process.exit(1);
    }
}

// 主函数
if (require.main === module) {
    fixMASBuild();
}

module.exports = { fixMASBuild };