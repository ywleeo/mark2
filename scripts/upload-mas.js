#!/usr/bin/env node

/**
 * Mac App Store 上传脚本
 * 将构建的 .pkg 文件上传到 App Store Connect
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

console.log('📤 准备上传到 Mac App Store...');

// 读取环境变量
const envFile = path.join(__dirname, '..', '.env');
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
            }
        }
    });
    
    console.log('✓ 环境变量加载完成');
} else {
    console.error('❌ 未找到 .env 文件');
    console.error('请先复制 .env.example 为 .env 并配置 APPLE_ID 和 APPLE_PASSWORD');
    process.exit(1);
}

// 检查必要的环境变量
const requiredVars = ['APPLE_ID', 'APPLE_PASSWORD'];
const missingVars = requiredVars.filter(key => !envVars[key] || envVars[key].trim() === '');

if (missingVars.length > 0) {
    console.error('❌ 缺少必要的环境变量:');
    missingVars.forEach(key => {
        console.error(`   - ${key}`);
    });
    console.error('请在 .env 文件中配置这些变量');
    process.exit(1);
}

// 查找构建的 .pkg 文件
const distDir = path.join(__dirname, '..', 'dist', 'mas-universal');

console.log('🔍 查找构建产物...');
console.log(`   搜索目录: ${distDir}`);

try {
    if (!fs.existsSync(distDir)) {
        console.error('❌ 未找到构建目录');
        console.error('请先运行 npm run build:mas 构建 Mac App Store 版本');
        process.exit(1);
    }
    
    // 读取目录中的所有 .pkg 文件
    const files = fs.readdirSync(distDir);
    const pkgFiles = files
        .filter(file => file.endsWith('.pkg') && file.startsWith('Mark2-'))
        .map(file => path.join(distDir, file));
    
    if (pkgFiles.length === 0) {
        console.error('❌ 未找到构建的 .pkg 文件');
        console.error('请先运行 npm run build:mas 构建 Mac App Store 版本');
        process.exit(1);
    }
    
    if (pkgFiles.length > 1) {
        console.warn('⚠️  找到多个 .pkg 文件，将使用最新的:');
        pkgFiles.forEach(file => console.log(`   - ${path.basename(file)}`));
    }
    
    // 使用最新的文件（按修改时间排序）
    const latestPkgFile = pkgFiles
        .map(file => ({ file, stat: fs.statSync(file) }))
        .sort((a, b) => b.stat.mtime - a.stat.mtime)[0].file;
    
    console.log(`✓ 找到构建文件: ${path.basename(latestPkgFile)}`);
    
    // 执行上传命令
    console.log('🚀 开始上传到 App Store Connect...');
    console.log(`   Apple ID: ${envVars.APPLE_ID}`);
    console.log(`   文件: ${path.basename(latestPkgFile)}`);
    
    const uploadProcess = spawn('xcrun', [
        'altool',
        '--upload-app',
        '-f', latestPkgFile,
        '-t', 'osx',
        '-u', envVars.APPLE_ID,
        '-p', envVars.APPLE_PASSWORD
    ], {
        stdio: 'inherit'
    });
    
    uploadProcess.on('close', (code) => {
        if (code === 0) {
            console.log('✅ 上传成功！');
            console.log('📝 接下来可以在 App Store Connect 中查看和管理你的应用');
            console.log('   网址: https://appstoreconnect.apple.com/');
        } else {
            console.error(`❌ 上传失败，退出码: ${code}`);
            console.error('请检查网络连接、凭据信息和文件完整性');
        }
        process.exit(code);
    });
    
    uploadProcess.on('error', (error) => {
        console.error('❌ 启动上传进程失败:', error);
        console.error('请确保已安装 Xcode 命令行工具: xcode-select --install');
        process.exit(1);
    });
    
} catch (error) {
    console.error('❌ 查找构建文件时出错:', error);
    process.exit(1);
}