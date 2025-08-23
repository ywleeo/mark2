#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * 构建环境设置脚本
 * 读取 .env 文件，临时修改 package.json 中的环境变量占位符为实际值
 */

const envFile = path.join(__dirname, '..', '.env');
const packageFile = path.join(__dirname, '..', 'package.json');
const packageBackupFile = path.join(__dirname, '..', 'package.json.backup');
const electronBuilderFile = path.join(__dirname, '..', 'electron-builder.json');
const electronBuilderBackupFile = path.join(__dirname, '..', 'electron-builder.json.backup');

// 读取环境变量
let envVars = {};

if (fs.existsSync(envFile)) {
    const envContent = fs.readFileSync(envFile, 'utf8');
    
    envContent.split('\n').forEach(line => {
        line = line.trim();
        if (line && !line.startsWith('#')) {
            const [key, value] = line.split('=');
            if (key && value) {
                // 移除引号
                const cleanValue = value.replace(/^["']|["']$/g, '');
                envVars[key.trim()] = cleanValue;
                console.log(`✓ 设置环境变量: ${key.trim()}`);
            }
        }
    });
    
    console.log('✓ 环境变量设置完成');
} else {
    // 没有 .env 文件时，设置一些默认值以避免构建错误
    envVars['APPLE_IDENTITY'] = '';
    envVars['APPLE_TEAM_ID'] = '';
    envVars['APPLE_ID'] = '';
    envVars['APPLE_PASSWORD'] = '';
    console.log('⚠️  未找到 .env 文件，使用默认设置');
    console.log('⚠️  使用空的环境变量值（构建将跳过代码签名）');
    console.log('提示：复制 .env.example 为 .env 并配置你的开发者信息');
}

// 获取传递给此脚本的参数
const args = process.argv.slice(2);

if (args.length > 0) {
    // 备份原始文件
    const packageContent = fs.readFileSync(packageFile, 'utf8');
    fs.writeFileSync(packageBackupFile, packageContent);
    
    let electronBuilderContent = null;
    let hasElectronBuilderFile = false;
    
    if (fs.existsSync(electronBuilderFile)) {
        electronBuilderContent = fs.readFileSync(electronBuilderFile, 'utf8');
        fs.writeFileSync(electronBuilderBackupFile, electronBuilderContent);
        hasElectronBuilderFile = true;
        console.log('📄 发现 electron-builder.json 文件');
    }
    
    try {
        // 替换 package.json 中的环境变量占位符
        let modifiedPackageContent = packageContent;
        Object.keys(envVars).forEach(key => {
            const placeholder = `\${${key}}`;
            modifiedPackageContent = modifiedPackageContent.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), envVars[key]);
        });
        
        // 写入修改后的 package.json
        fs.writeFileSync(packageFile, modifiedPackageContent);
        console.log('📝 临时修改 package.json 完成');
        
        // 如果存在 electron-builder.json，也进行环境变量替换和条件性配置处理
        if (hasElectronBuilderFile) {
            let modifiedElectronBuilderContent = electronBuilderContent;
            
            // 环境变量替换
            Object.keys(envVars).forEach(key => {
                const placeholder = `\${${key}}`;
                modifiedElectronBuilderContent = modifiedElectronBuilderContent.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), envVars[key]);
            });
            
            // 条件性配置处理
            const configObj = JSON.parse(modifiedElectronBuilderContent);
            
            // 检查 provisioning profile 文件是否存在
            const provisioningProfilePath = path.join(__dirname, '..', 'build', 'embedded.provisionprofile');
            if (!fs.existsSync(provisioningProfilePath)) {
                console.log('⚠️  未找到 provisioning profile，将跳过 MAS 签名配置');
                // 移除 provisioning profile 配置
                if (configObj.build && configObj.build.mas && configObj.build.mas.provisioningProfile) {
                    delete configObj.build.mas.provisioningProfile;
                }
            } else {
                console.log('✓ 找到 provisioning profile，将启用完整 MAS 签名配置');
                // 确保 provisioning profile 配置存在
                if (configObj.build && configObj.build.mas && !configObj.build.mas.provisioningProfile) {
                    configObj.build.mas.provisioningProfile = 'build/embedded.provisionprofile';
                }
            }
            
            // 检查 entitlements 文件
            const entitlementsPath = path.join(__dirname, '..', 'build', 'entitlements.mas.plist');
            if (!fs.existsSync(entitlementsPath)) {
                console.log('⚠️  未找到 entitlements 文件，将移除相关配置');
                if (configObj.build && configObj.build.mas) {
                    delete configObj.build.mas.entitlements;
                    delete configObj.build.mas.entitlementsInherit;
                }
                if (configObj.build && configObj.build.mac) {
                    delete configObj.build.mac.entitlements;
                    delete configObj.build.mac.entitlementsInherit;
                }
            }
            
            modifiedElectronBuilderContent = JSON.stringify(configObj, null, 2);
            fs.writeFileSync(electronBuilderFile, modifiedElectronBuilderContent);
            console.log('📝 临时修改 electron-builder.json 完成（含条件性配置）');
        }
        
        // 启动 electron-builder
        console.log('🚀 启动 electron-builder...');
        const { spawn } = require('child_process');
        
        const electronBuilder = spawn('npx', ['electron-builder', ...args], {
            stdio: 'inherit'
        });
        
        const restoreFiles = () => {
            // 恢复原始文件
            fs.writeFileSync(packageFile, packageContent);
            fs.unlinkSync(packageBackupFile);
            
            if (hasElectronBuilderFile) {
                fs.writeFileSync(electronBuilderFile, electronBuilderContent);
                fs.unlinkSync(electronBuilderBackupFile);
                console.log('🔄 恢复原始文件完成 (package.json + electron-builder.json)');
            } else {
                console.log('🔄 恢复原始文件完成 (package.json)');
            }
        };
        
        electronBuilder.on('close', (code) => {
            restoreFiles();
            process.exit(code);
        });
        
        electronBuilder.on('error', (error) => {
            restoreFiles();
            console.error('启动 electron-builder 失败:', error);
            process.exit(1);
        });
        
        // 处理 SIGINT 信号 (Ctrl+C)
        process.on('SIGINT', () => {
            console.log('\n📋 收到中断信号，正在清理...');
            restoreFiles();
            process.exit(0);
        });
        
    } catch (error) {
        // 出错时恢复原始文件
        if (fs.existsSync(packageBackupFile)) {
            fs.writeFileSync(packageFile, fs.readFileSync(packageBackupFile, 'utf8'));
            fs.unlinkSync(packageBackupFile);
        }
        
        if (hasElectronBuilderFile && fs.existsSync(electronBuilderBackupFile)) {
            fs.writeFileSync(electronBuilderFile, fs.readFileSync(electronBuilderBackupFile, 'utf8'));
            fs.unlinkSync(electronBuilderBackupFile);
        }
        
        console.error('处理失败:', error);
        process.exit(1);
    }
}