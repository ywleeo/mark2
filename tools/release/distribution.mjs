/** 渠道构建计划：集中约束 Tauri、Cargo 和 Vite，不修改工作区源码。 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const MACOS_RELEASE_TARGET = 'aarch64-apple-darwin';

/** 读取唯一发行版本，并阻止不同版本源意外打进同一个包。 */
export function readReleaseVersion(root = ROOT) {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
    const tauri = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'));
    const cargo = readFileSync(resolve(root, 'src-tauri/Cargo.toml'), 'utf8').match(/^version = "([^"]+)"/m)?.[1];
    if (pkg.version !== tauri.version || pkg.version !== cargo) throw new Error('package.json、tauri.conf.json 和 Cargo.toml 版本不一致');
    return pkg.version;
}

/** 创建可审查的纯数据计划；额外 CLI 参数不能覆盖渠道约束。 */
export function createBuildPlan({ channel = 'github', args = [], env = process.env, platform = process.platform,
    buildNumber, updaterArtifacts } = {}) {
    if (!['github', 'mas'].includes(channel)) throw new Error(`未知发行渠道：${channel}`);
    if (channel === 'mas' && platform !== 'darwin') throw new Error('MAS 构建必须在 macOS 上运行');
    if (args.some(arg => /^(--features|--no-default-features|--profile)(=|$)/.test(arg) || arg.startsWith('-f') || arg === '--')) {
        throw new Error('Cargo features 和构建 profile 由发行渠道管理');
    }
    if (channel === 'mas' && args.some(arg => arg === '--debug')) throw new Error('MAS 发布包不能使用 debug 构建');
    const { values: { target: targets = [] } } = parseArgs({ args, strict: false, allowPositionals: true,
        options: { target: { type: 'string', short: 't', multiple: true } } });
    if (targets.some(target => (channel === 'mas' || target.endsWith('-apple-darwin')) && target !== MACOS_RELEASE_TARGET)) {
        throw new Error(`macOS 发布仅支持 ${MACOS_RELEASE_TARGET}`);
    }
    const buildArgs = platform === 'darwin' && targets.length === 0
        ? [...args, '--target', MACOS_RELEASE_TARGET] : args;
    const config = JSON.parse(readFileSync(resolve(ROOT, `src-tauri/tauri.${channel}.conf.json`), 'utf8'));
    if (updaterArtifacts === false) config.bundle.createUpdaterArtifacts = false;
    if (buildNumber !== undefined) {
        if (!/^\d{1,4}(\.\d{1,2}){0,2}$/.test(String(buildNumber))) throw new Error('build-number 必须是合法 CFBundleVersion，例如 100 或 1.7.73');
        config.bundle.macOS.bundleVersion = String(buildNumber);
    }
    const childEnv = { ...env, MARK2_DISTRIBUTION: channel };
    if (channel === 'mas') childEnv.CARGO_TARGET_DIR = resolve(ROOT, 'src-tauri/target/mas');
    return { channel, config, env: childEnv,
        args: ['build', ...buildArgs, '--config', JSON.stringify(config), '--', '--no-default-features'],
        frontendDir: resolve(ROOT, channel === 'mas' ? 'dist-mas' : 'dist'),
        targetDir: childEnv.CARGO_TARGET_DIR || resolve(ROOT, 'src-tauri/target') };
}
