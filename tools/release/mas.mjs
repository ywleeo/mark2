/** 中文 MAS 发布工具：预检、签名打包、校验上传及精确构建提审，默认不发布。 */
import { cp, chmod, mkdir, readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, parseEnv } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { ROOT, MACOS_RELEASE_TARGET, createBuildPlan, readReleaseVersion } from './distribution.mjs';
import { run } from './process.mjs';
import { encodePlist, inspectSigning, parsePlist } from './signing.mjs';
import { createMasEntitlements } from './entitlements.mjs';
import { createAppStoreClient, findApp, findBuild, submitReview } from './appStoreConnect.mjs';

const ACTIONS = ['init', 'preflight', 'plan', 'package', 'verify', 'upload', 'status', 'submit', 'release'];

/** 展开用户配置中的路径，始终以仓库为相对路径基准。 */
function localPath(value) {
    return value ? resolve(ROOT, value.replace(/^~(?=\/|$)|^\$HOME(?=\/|$)|^\$\{HOME\}(?=\/|$)/, homedir())) : undefined;
}

/** 读取仅本机保存的发布配置；兼容旧 notary.env，但不执行其中的 shell 代码。 */
export async function loadConfig(configPath, env = process.env) {
    const legacy = await readFile(resolve(ROOT, 'apple_developer/notary.env'), 'utf8').catch(() => '');
    const variables = { ...parseEnv(legacy), ...env };
    const file = localPath(configPath || variables.MARK2_MAS_CONFIG || 'apple_developer/mas-release.json');
    let config = {};
    try { config = JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const result = { ...config,
        signingIdentity: variables.APPLE_SIGNING_IDENTITY || config.signingIdentity,
        installerIdentity: variables.APPLE_INSTALLER_IDENTITY || config.installerIdentity,
        profile: localPath(variables.APPLE_PROVISIONING_PROFILE || config.profile),
        keyId: variables.APP_STORE_CONNECT_API_KEY || config.keyId,
        issuerId: variables.APP_STORE_CONNECT_API_ISSUER || config.issuerId,
        keyPath: localPath(variables.APP_STORE_CONNECT_KEY_PATH || config.keyPath),
        privacyPolicyUrl: variables.MARK2_PRIVACY_POLICY_URL || config.privacyPolicyUrl,
        file };
    return result;
}

/** 检查本机工具和 Apple Silicon 构建目标，并返回实际签名身份。 */
async function preflight(config, bundleId) {
    if (process.platform !== 'darwin') throw new Error('MAS 发布工具需要 macOS 和完整 Xcode');
    for (const [tool, args] of [['xcodebuild', ['-version']], ['xcrun', ['--find', 'altool']],
        ['xcrun', ['--find', 'codesign']], ['python3', ['--version']], ['xcrun', ['--find', 'productbuild']]]) {
        await run(tool, args, { capture: true });
    }
    const installed = await run('rustup', ['target', 'list', '--installed'], { capture: true });
    if (!installed.split(/\s+/).includes(MACOS_RELEASE_TARGET)) {
        throw new Error(`缺少 Rust target，请运行 rustup target add ${MACOS_RELEASE_TARGET}`);
    }
    const signing = await inspectSigning(config, bundleId);
    console.log(`签名预检通过：${bundleId}; team=${signing.team}; profile 有效期至 ${signing.profile.expires}`);
    if (!config.privacyPolicyUrl) console.log('提审前待办：配置 privacyPolicyUrl，并在 App Store Connect 完善隐私信息、截图、分级和审核说明。');
    console.log('商业模式：App Store 一次购买，全功能开放，无订阅或应用内购买。');
    return signing;
}

/** 读取文件 SHA-256，用于把后续上传锁定到经过本地验证的具体安装包。 */
export async function fileHash(path) {
    return createHash('sha256').update(await readFile(path)).digest('hex');
}

/** 验证配置、版本和目标，生成固定路径；不修改任何源码版本号。 */
export function releasePaths({ version, buildNumber, target }) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('发布版本必须是 x.y.z');
    createBuildPlan({ channel: 'mas', buildNumber, platform: 'darwin' });
    if (target !== MACOS_RELEASE_TARGET) throw new Error(`Mac App Store 发布仅支持 ${MACOS_RELEASE_TARGET}`);
    const directory = resolve(ROOT, 'artifacts/mas', `${version}-${buildNumber}`, target);
    return { directory, app: join(directory, 'Mark2.app'), pkg: join(directory, 'Mark2-mas.pkg'),
        manifest: join(directory, 'manifest.json'), entitlements: join(directory, 'Mark2.entitlements') };
}

/** 构建并签名固定版本；每次产物附带渠道、构建号、来源提交和安装包校验和。 */
async function packageApp(config, options, paths, bundleId) {
    const signing = await preflight(config, bundleId);
    if (await stat(paths.directory).then(() => true, () => false)) throw new Error(`产物目录已存在，请换一个 build-number 或先自行归档：${paths.directory}`);
    await mkdir(paths.directory, { recursive: true });
    const baseEntitlements = await parsePlist(await readFile(resolve(ROOT, 'src-tauri/macos/Mark2.entitlements'), 'utf8'));
    const effective = createMasEntitlements(baseEntitlements, signing, bundleId);
    await writeFile(paths.entitlements, await encodePlist(effective));
    const plan = createBuildPlan({ channel: 'mas', args: ['--target', options.target], buildNumber: options.buildNumber,
        env: { ...process.env, APPLE_SIGNING_IDENTITY: signing.identity.name,
            APPLE_PROVISIONING_PROFILE: signing.profile.path } });
    plan.config.bundle.macOS.entitlements = paths.entitlements;
    // 政策链接只注入当前构建进程，不会写入仓库配置。
    if (config.privacyPolicyUrl) plan.env.MARK2_PRIVACY_POLICY_URL = config.privacyPolicyUrl;
    plan.args[plan.args.indexOf('--config') + 1] = JSON.stringify(plan.config);
    await run(process.execPath, [resolve(ROOT, 'node_modules/@tauri-apps/cli/tauri.js'), ...plan.args], { env: plan.env });
    const proof = JSON.parse(await readFile(resolve(plan.frontendDir, 'distribution.json'), 'utf8'));
    if (proof.channel !== 'mas' || proof.desktopUpdaterIncluded || proof.storeKitSubscriptions) throw new Error('MAS 前端渠道或买断模式验证失败');
    const builtApp = resolve(plan.targetDir, options.target, 'release/bundle/macos/Mark2.app');
    await cp(builtApp, paths.app, { recursive: true });
    const embeddedProfile = join(paths.app, 'Contents/embedded.provisionprofile');
    await cp(signing.profile.path, embeddedProfile);
    // 安装后由 root 拥有；普通用户也必须能读取描述文件以验证代码签名（Apple 90255）。
    await chmod(embeddedProfile, 0o644);
    await run('codesign', ['--force', '--sign', signing.identity.hash, '--entitlements', paths.entitlements,
        '--options', 'runtime', '--generate-entitlement-der', paths.app]);
    await run('codesign', ['--verify', '--deep', '--strict', paths.app]);
    const ent = await parsePlist(await run('codesign', ['-d', '--entitlements', ':-', paths.app], { capture: true }));
    if (ent['com.apple.security.app-sandbox'] !== true) throw new Error('最终 App 签名中缺少沙盒权限，停止打包');
    const info = await parsePlist(await readFile(join(paths.app, 'Contents/Info.plist'), 'utf8'));
    if (info.CFBundleIdentifier !== bundleId || info.CFBundleShortVersionString !== options.version || info.CFBundleVersion !== options.buildNumber) throw new Error('最终 App 的 Bundle ID、版本或构建号与计划不一致');
    // 在制作安装包前验证实际产物符合 Apple Silicon 商店版的系统要求。
    const executable = join(paths.app, 'Contents/MacOS', info.CFBundleExecutable);
    const architectures = await run('xcrun', ['lipo', '-archs', executable], { capture: true });
    if (architectures.trim() !== 'arm64' || info.LSMinimumSystemVersion !== plan.config.bundle.macOS.minimumSystemVersion) {
        throw new Error('最终 App 的架构或最低 macOS 版本与商店构建计划不一致');
    }
    await run('productbuild', ['--component', paths.app, '/Applications', '--sign', signing.installer.hash,
        '--product', join(paths.app, 'Contents/Info.plist'), paths.pkg]);
    await run('pkgutil', ['--check-signature', paths.pkg]);
    const commit = (await run('git', ['rev-parse', 'HEAD'], { capture: true })).trim();
    const dirty = Boolean((await run('git', ['status', '--porcelain'], { capture: true })).trim());
    const manifest = { schema: 1, channel: 'mas', bundleId, version: options.version, buildNumber: options.buildNumber,
        target: options.target, team: signing.team, commit, dirty, createdAt: new Date().toISOString(),
        pkgSha256: await fileHash(paths.pkg), privacyPolicyUrl: config.privacyPolicyUrl || null,
        purchaseModel: 'paid-upfront' };
    await writeFile(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`MAS 打包完成：${paths.pkg}\n发布报告：${paths.manifest}`);
}

/** 上传前重新验证实际包与发布报告，不能误用 GitHub 包或被替换的旧文件。 */
export async function verifyArtifact(paths, options, bundleId) {
    const manifest = JSON.parse(await readFile(paths.manifest, 'utf8'));
    if (manifest.schema !== 1 || manifest.channel !== 'mas' || manifest.purchaseModel !== 'paid-upfront' || manifest.bundleId !== bundleId
        || manifest.version !== options.version || manifest.buildNumber !== options.buildNumber || manifest.target !== options.target) {
        throw new Error('产物报告与当前发布目标不一致');
    }
    if (await fileHash(paths.pkg) !== manifest.pkgSha256) throw new Error('安装包校验和变化，请重新打包，禁止上传被替换的产物');
    await run('pkgutil', ['--check-signature', paths.pkg]);
    return manifest;
}

/** 上传前先执行苹果服务端校验；只在临时目录放置一份 API 私钥，结束后清理。 */
async function upload(config, paths, options, bundleId) {
    await verifyArtifact(paths, options, bundleId);
    await createAppStoreClient(config);
    if (!/^[A-Za-z\d]+$/.test(config.keyId)) throw new Error('无效的 App Store Connect keyId');
    const temporary = await mkdtemp(join(tmpdir(), 'mark2-mas-upload-'));
    try {
        await writeFile(join(temporary, `AuthKey_${config.keyId}.p8`), await readFile(config.keyPath), { mode: 0o600 });
        const env = { ...process.env, API_PRIVATE_KEYS_DIR: temporary };
        const args = ['--api-key', config.keyId, '--api-issuer', config.issuerId];
        await run('xcrun', ['altool', '--validate-app', paths.pkg, ...args], { env });
        await run('xcrun', ['altool', '--upload-package', paths.pkg, ...args], { env });
        console.log(`上传请求已完成。请用 status 查询版本 ${options.version}、构建 ${options.buildNumber} 的处理状态。`);
    } finally { await rm(temporary, { recursive: true, force: true }); }
}

/** 输出不会发布的构建计划，不读取私钥、访问 Apple 服务或触发版本提交。 */
function printPlan(options, paths) {
    const plan = createBuildPlan({ channel: 'mas', args: ['--target', options.target], buildNumber: options.buildNumber });
    console.log(JSON.stringify({ ...options, output: paths.directory, cargoFeatures: ['mas'],
        updater: false, productionDevtools: false, sandbox: true, tauriConfig: plan.config }, null, 2));
}

/** 对提审所需的公开政策链接做格式检查，避免构建上传完成后才发现缺项。 */
function requirePrivacyPolicy(config) {
    if (!config.privacyPolicyUrl || new URL(config.privacyPolicyUrl).protocol !== 'https:') {
        throw new Error('提审前请配置公开的 HTTPS privacyPolicyUrl，并在 App Store Connect 中完成隐私与审核资料');
    }
}

/** 中文帮助说明，分步命令默认不把本地打包隐式升级为上传或提审。 */
function help() {
    console.log(`Mark2 Mac App Store 发布工具\n\n用法：npm run release:mas -- [--action 动作] [选项]\n\n动作：\n  init       配置本机证书、描述文件和 API Key 路径\n  preflight  检查本机工具、证书及描述文件（不联网）\n  plan       显示渠道与产物计划（不构建、不联网）\n  package    构建、签名并生成 PKG（不上传）\n  verify     重新验证指定产物\n  upload     验证并上传指定安装包\n  status     查询明确指定版本和构建号\n  submit     将指定构建提交审核\n  release    打包、上传、等待处理并提审\n\n选项：\n  --version / --ver X.Y.Z  构建时与源码一致；其他动作可选择已有版本\n  --build-number 100      CFBundleVersion；重传同一版本时递增\n  --target TRIPLE         仅支持 ${MACOS_RELEASE_TARGET}\n  --config PATH           默认 apple_developer/mas-release.json\n  --auto-release          审核通过后自动发布；默认人工发布\n  --wait-minutes 30        release 等待苹果处理的上限\n\n无参数时显示中文菜单；非交互环境显示帮助。工具不会自动改版本、commit、push 或发布 GitHub Release。`);
}

/** 首次使用时只保存非私钥内容的配置，文件属于已忽略的 apple_developer 目录。 */
async function initialize(config, rl) {
    const result = {};
    for (const [key, label] of [['signingIdentity', '应用分发证书名称（留空自动发现）'],
        ['installerIdentity', '安装器分发证书名称（留空自动发现）'], ['profile', 'MAS 描述文件路径（留空自动发现）'],
        ['keyId', 'App Store Connect API Key ID'], ['issuerId', 'Issuer ID'], ['keyPath', 'API 私钥 .p8 路径'],
        ['privacyPolicyUrl', '公开的隐私政策 HTTPS 链接']]) {
        const value = (await rl.question(`${label}${config[key] ? '（回车保留已有值）' : ''}：`)).trim();
        if (value || config[key]) result[key] = value || config[key];
    }
    await mkdir(dirname(config.file), { recursive: true });
    await writeFile(config.file, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
    console.log(`已保存本机配置：${config.file}。私钥内容没有复制到配置文件。`);
}

/** 执行指定动作；交互菜单只有用户选定操作后才开始该步骤。 */
export async function main(argv = process.argv.slice(2)) {
    const { values } = parseArgs({ args: argv, options: { action: { type: 'string' }, version: { type: 'string' },
        ver: { type: 'string' }, 'build-number': { type: 'string' }, target: { type: 'string' }, config: { type: 'string' },
        'auto-release': { type: 'boolean' }, 'wait-minutes': { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
    if (values.help || (!values.action && !process.stdin.isTTY)) { help(); return; }
    let action = values.action;
    let rl;
    try {
        if (!action) {
            rl = createInterface({ input: process.stdin, output: process.stdout });
            console.log('Mark2 Mac App Store 发布工具\n1. 首次配置\n2. 发布预检\n3. 本地签名打包\n4. 校验并上传已有包\n5. 查看构建状态\n6. 提交审核\n7. 查看发布计划\n0. 退出');
            const choice = (await rl.question('选择操作：')).trim();
            if (choice === '0') return;
            action = ({ 1: 'init', 2: 'preflight', 3: 'package', 4: 'upload', 5: 'status', 6: 'submit', 7: 'plan' })[choice];
            if (!action) throw new Error('无效选择');
        }
        if (!ACTIONS.includes(action)) throw new Error(`未知动作：${action}`);
        const config = await loadConfig(values.config);
        if (action === 'init') {
            if (!rl) {
                if (!process.stdin.isTTY) throw new Error('init 需要交互终端');
                rl = createInterface({ input: process.stdin, output: process.stdout });
            }
            await initialize(config, rl); return;
        }
        if (values.version && values.ver && values.version !== values.ver) throw new Error('--version 和 --ver 不能指定不同版本');
        const requestedVersion = values.version || values.ver;
        const building = ['package', 'release', 'plan', 'preflight'].includes(action);
        const sourceVersion = building || !requestedVersion ? readReleaseVersion() : null;
        const version = requestedVersion || sourceVersion;
        if (building && requestedVersion && requestedVersion !== sourceVersion) throw new Error('指定版本与仓库不一致，请先同步版本源，工具不会自动改源码');
        const buildNumber = values['build-number'] || (rl && action !== 'preflight'
            ? (await rl.question(`构建号（默认 ${version}，重新上传时需要递增）：`)).trim() : '') || version;
        const options = { version, buildNumber, target: values.target || MACOS_RELEASE_TARGET, autoRelease: values['auto-release'] || false };
        const waitMinutes = Number(values['wait-minutes'] || '30');
        if (!Number.isFinite(waitMinutes) || waitMinutes <= 0 || waitMinutes > 120) throw new Error('wait-minutes 必须在 0 到 120 之间');
        const paths = releasePaths(options);
        const bundleId = JSON.parse(await readFile(resolve(ROOT, 'src-tauri/tauri.conf.json'), 'utf8')).identifier;
        if (action === 'plan') { printPlan(options, paths); return; }
        if (action === 'submit' || action === 'release') requirePrivacyPolicy(config);
        if (rl && ['upload', 'submit'].includes(action)) {
            const answer = await rl.question(`将对 ${version} (${buildNumber}) 执行${action === 'upload' ? '上传' : '提审'}，输入 yes 继续：`);
            if (answer.trim() !== 'yes') return;
        }
        if (action === 'preflight') { await preflight(config, bundleId); return; }
        if (action === 'package' || action === 'release') await packageApp(config, options, paths, bundleId);
        if (action === 'verify') { await verifyArtifact(paths, options, bundleId); console.log('产物验证通过'); }
        if (action === 'upload' || action === 'release') await upload(config, paths, options, bundleId);
        if (action === 'submit' || action === 'release') {
            const manifest = await verifyArtifact(paths, options, bundleId);
            if (manifest.privacyPolicyUrl !== config.privacyPolicyUrl) {
                throw new Error('安装包中的隐私政策链接与当前配置不一致，请使用新构建号重新打包上传后提审');
            }
            if (manifest.purchaseModel !== 'paid-upfront') throw new Error('产物不是全功能买断版，请重新打包');
        }
        if (['status', 'submit', 'release'].includes(action)) {
            const client = await createAppStoreClient(config);
            const app = await findApp(client, bundleId);
            let build = await findBuild(client, app.id, version, buildNumber);
            if (action === 'release') {
                const deadline = Date.now() + waitMinutes * 60000;
                while ((!build || build.attributes.processingState === 'PROCESSING') && Date.now() < deadline) {
                    console.log(`等待苹果处理 ${version} (${buildNumber})…`);
                    await new Promise(resolve => setTimeout(resolve, 30000));
                    build = await findBuild(client, app.id, version, buildNumber);
                }
            }
            if (action === 'status') {
                console.log(build ? JSON.stringify({ version, buildNumber, id: build.id, ...build.attributes }, null, 2) : '尚未查询到该版本和构建号');
            } else {
                await submitReview(client, { appId: app.id, ...options });
                console.log(`已提交审核：${version} (${buildNumber})；审核通过后${options.autoRelease ? '自动发布' : '等待人工发布'}。`);
            }
        }
    } finally { rl?.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    main().catch(error => {
        console.error(`发布失败：${error.message}`);
        if (error.appStoreErrors) console.error(JSON.stringify({ path: error.requestPath, errors: error.appStoreErrors }, null, 2));
        process.exitCode = 1;
    });
}
