#!/usr/bin/env node

/**
 * Mac App Store 完整打包和上传脚本
 * 包含构建、删除 Login Helper、重新签名、上传的完整流程
 */

const { spawn, exec } = require('child_process');
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
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function execCommand(command, description) {
    return new Promise((resolve, reject) => {
        log(`\n🔄 ${description}`, 'blue');
        log(`执行命令: ${command}`, 'cyan');
        
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
                log(`✅ ${stdout.trim()}`, 'green');
            }
            
            log(`✅ ${description}完成`, 'green');
            resolve(stdout);
        });
    });
}

async function buildMAS() {
    try {
        log('🚀 开始 Mac App Store 完整构建和上传流程', 'bright');
        
        // 步骤 1: 执行 MAS 构建
        log('\n📦 步骤 1: 构建 Mac App Store 版本', 'magenta');
        await execCommand('npm run build:mas', 'MAS 构建');
        
        // 步骤 2: 检查构建产物
        const packageJsonPath = path.join(__dirname, '..', 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        const version = packageJson.version;
        
        const appPath = 'dist/mas-universal/Mark2.app';
        const pkgPath = `dist/mas-universal/Mark2-${version}-universal.pkg`;
        const libraryPath = `${appPath}/Contents/Library`;
        
        log(`📋 当前版本: ${version}`, 'cyan');
        
        if (!fs.existsSync(appPath)) {
            throw new Error(`应用包不存在: ${appPath}`);
        }
        
        log(`\n🔍 步骤 2: 检查应用包结构`, 'magenta');
        
        // 检查是否存在 Library 目录
        if (fs.existsSync(libraryPath)) {
            log(`发现 Library 目录: ${libraryPath}`, 'yellow');
            
            // 列出 Library 目录内容
            const libraryContents = fs.readdirSync(libraryPath, { withFileTypes: true });
            log(`Library 目录内容:`, 'cyan');
            libraryContents.forEach(item => {
                log(`  - ${item.name} ${item.isDirectory() ? '(目录)' : '(文件)'}`, 'cyan');
            });
            
            // 步骤 3: 删除 Library 目录
            log(`\n🗑️  步骤 3: 删除 Login Helper 组件`, 'magenta');
            await execCommand(`rm -rf "${libraryPath}"`, '删除 Library 目录');
            
            // 验证删除
            if (fs.existsSync(libraryPath)) {
                throw new Error('Library 目录删除失败');
            }
            log('✅ Library 目录已成功删除', 'green');
        } else {
            log('✅ 未发现 Library 目录，无需删除', 'green');
        }
        
        // 步骤 3.5: 删除所有 Frameworks 下的 Helper 进程
        log(`\n🗑️  步骤 3.5: 删除所有 Electron Helper 进程`, 'magenta');
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
            } else {
                log(`ℹ️  ${helperPattern} 不存在`, 'cyan');
            }
        }
        
        log('✅ 所有 Helper 组件检查完成', 'green');
        
        // 步骤 4: 重新签名主应用
        log(`\n✍️  步骤 4: 重新签名主应用`, 'magenta');
        const signIdentity = '3rd Party Mac Developer Application: yuwei li (YH83TRKYT7)';
        const entitlementsPath = path.join(__dirname, '..', 'entitlements.mas.plist');
        
        // 签名主应用（使用主 entitlements）
        await execCommand(
            `codesign --force --sign "${signIdentity}" --entitlements "${entitlementsPath}" "${appPath}"`, 
            '主应用签名'
        );
        
        // 步骤 5: 验证签名
        log(`\n🔐 步骤 5: 验证应用签名`, 'magenta');
        await execCommand(`codesign --verify --verbose "${appPath}"`, '签名验证');
        
        // 步骤 6: 重新生成 .pkg 文件（关键步骤！）
        log(`\n📦 步骤 6: 重新生成 .pkg 文件`, 'magenta');
        
        // 删除旧的 .pkg 文件
        await execCommand(`rm -f "${pkgPath}"`, '删除旧的 .pkg 文件');
        
        // 使用 productbuild 重新生成 .pkg
        const installerIdentity = '3rd Party Mac Developer Installer: yuwei li (YH83TRKYT7)';
        await execCommand(
            `productbuild --component "${appPath}" /Applications --sign "${installerIdentity}" "${pkgPath}"`,
            '重新生成 .pkg 文件'
        );
        
        // 验证新的 .pkg 文件不包含 Library
        log(`\n🔍 步骤 7: 验证新 .pkg 文件`, 'magenta');
        const libraryCheck = await execCommand(
            `pkgutil --payload-files "${pkgPath}" | grep -i library || echo "✅ 未发现 Library 目录"`,
            '检查 .pkg 文件内容'
        );
        
        // 步骤 8: 显示最终包信息
        log(`\n📋 步骤 8: 最终构建产物`, 'magenta');
        await execCommand(`ls -la "dist/mas-universal/"`, '列出构建产物');
        
        // 步骤 9: 上传到 App Store
        log(`\n🚀 步骤 9: 上传到 App Store Connect`, 'magenta');
        
        // 读取环境变量
        const envFile = path.join(__dirname, '..', '.env');
        let appleId = process.env.APPLE_ID || '';
        let applePassword = process.env.APPLE_PASSWORD || '';
        
        if (fs.existsSync(envFile)) {
            const envContent = fs.readFileSync(envFile, 'utf8');
            const appleIdMatch = envContent.match(/APPLE_ID="?([^"\n]+)"?/);
            const passwordMatch = envContent.match(/APPLE_PASSWORD="?([^"\n]+)"?/);
            
            if (appleIdMatch) appleId = appleIdMatch[1];
            if (passwordMatch) applePassword = passwordMatch[1];
        }
        
        await execCommand(
            `xcrun altool --upload-app --type osx --file "${pkgPath}" --username "${appleId}" --password "${applePassword}" --verbose`,
            'App Store 上传'
        );
        
        // 步骤 10: 验证上传结果
        log(`\n✅ 步骤 10: 验证上传状态`, 'magenta');
        await execCommand(
            `xcrun altool --list-apps --username "${appleId}" --password "${applePassword}"`,
            '获取应用列表'
        );
        
        // 完成
        log(`\n🎉 Mac App Store 构建和上传流程完成！`, 'bright');
        log(`📱 应用已成功提交到 App Store Connect`, 'green');
        log(`🔗 请访问 https://appstoreconnect.apple.com 查看审核状态`, 'cyan');
        
    } catch (error) {
        log(`\n❌ 流程执行失败: ${error.message}`, 'red');
        process.exit(1);
    }
}

// 主函数
if (require.main === module) {
    buildMAS();
}

module.exports = { buildMAS };