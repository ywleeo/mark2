/** 渠道计划、签名身份约束、产物完整性及 App Store 精确构建提审回归。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBuildPlan, readReleaseVersion } from '../tools/release/distribution.mjs';
import { chooseIdentity, parseIdentities, validateProfile } from '../tools/release/signing.mjs';
import { createMasEntitlements } from '../tools/release/entitlements.mjs';
import { createToken, createAppStoreClient, findBuild, submitReview } from '../tools/release/appStoreConnect.mjs';
import { fileHash, verifyArtifact, releasePaths } from '../tools/release/mas.mjs';

test('MAS 与 GitHub 构建计划隔离 Cargo features、权限、更新产物和前端目录', async () => {
    const env = { TEST: 'untouched' };
    const mas = createBuildPlan({ channel: 'mas', platform: 'darwin', env, buildNumber: '101' });
    const github = createBuildPlan({ channel: 'github', platform: 'win32', env });
    assert.deepEqual(mas.config.build.features, ['mas']);
    assert.deepEqual(mas.config.app.security.capabilities, ['default']);
    assert.equal(mas.config.plugins.updater, null);
    assert.equal(mas.config.bundle.createUpdaterArtifacts, false);
    assert.equal(mas.config.bundle.macOS.bundleVersion, '101');
    assert.equal(mas.config.bundle.macOS.minimumSystemVersion, '13.0');
    assert.deepEqual(mas.args.slice(-2), ['--', '--no-default-features']);
    assert.deepEqual(github.config.build.features, ['github']);
    assert.ok(github.config.app.security.capabilities.includes('desktop-updater'));
    assert.equal(github.config.bundle.createUpdaterArtifacts, true);
    assert.notEqual(mas.frontendDir, github.frontendDir);
    assert.notEqual(mas.targetDir, github.targetDir);
    const local = createBuildPlan({ channel: 'github', updaterArtifacts: false });
    assert.equal(local.config.bundle.createUpdaterArtifacts, false);
    assert.ok(local.config.app.security.capabilities.includes('desktop-updater'));
    assert.deepEqual(env, { TEST: 'untouched' });
    assert.equal(readReleaseVersion(), JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version);
});

test('拒绝未知渠道、非 macOS 的 MAS、私自覆盖 features 和非法构建号', () => {
    for (const options of [{ channel: 'other' }, { channel: 'mas', platform: 'win32' },
        { args: ['--features', 'mas'] }, { args: ['--', '--features=github'] },
        { channel: 'mas', platform: 'darwin', args: ['--debug'] }, { buildNumber: '../../oops' }]) {
        assert.throws(() => createBuildPlan(options));
    }
    assert.throws(() => releasePaths({ version: '../bad', buildNumber: '1', target: 'aarch64-apple-darwin' }));
});

test('macOS 发布默认使用 Apple Silicon，阻止通过目标参数重新构建 Intel 包', () => {
    for (const channel of ['github', 'mas']) {
        const plan = createBuildPlan({ channel, platform: 'darwin' });
        assert.deepEqual(plan.args.slice(1, 3), ['--target', 'aarch64-apple-darwin']);
        for (const args of [['--target', 'x86_64-apple-darwin'], ['-tuniversal-apple-darwin'],
            ['--target=x86_64-apple-darwin', '--target=aarch64-apple-darwin']]) {
            assert.throws(() => createBuildPlan({ channel, platform: 'darwin', args }), /仅支持 aarch64-apple-darwin/);
        }
    }
    const windows = createBuildPlan({ platform: 'win32', args: ['--target', 'x86_64-pc-windows-msvc'] });
    assert.deepEqual(windows.args.slice(1, 3), ['--target', 'x86_64-pc-windows-msvc']);
    assert.throws(() => releasePaths({ version: '1.7.72', buildNumber: '1', target: 'x86_64-apple-darwin' }), /仅支持/);
});

test('用户额外 Tauri 配置排在渠道配置之前，最终渠道约束保持确定', () => {
    const plan = createBuildPlan({ platform: 'darwin', channel: 'mas', args: ['--config', '{"build":{"features":["github"]}}'] });
    const finalConfig = JSON.parse(plan.args.at(-3));
    assert.deepEqual(finalConfig.build.features, ['mas']);
});

test('签名证书唯一匹配；多个团队和非商店身份不会被静默选择', () => {
    const a = 'A'.repeat(40), b = 'B'.repeat(40);
    const identities = parseIdentities(`  1) ${a} "Mac App Distribution: A (TEAM)"\n  2) ${b} "Apple Distribution: B (OTHER)"`);
    const pattern = /^(Mac App Distribution|Apple Distribution):/;
    assert.equal(chooseIdentity(identities, a.toLowerCase(), pattern).hash, a);
    assert.throws(() => chooseIdentity(identities, undefined, pattern), /多个/);
    assert.throws(() => chooseIdentity(identities, 'Developer ID Application: A', pattern), /未找到/);
});

test('描述文件验证拒绝开发、过期、证书不匹配和其他 App ID', () => {
    const identity = { hash: 'ABC' };
    const profile = { expires: '2030-01-01T00:00:00Z', certificates: ['ABC'], entitlements: {
        'com.apple.application-identifier': 'TEAM.cc.altron.mark2', 'com.apple.developer.team-identifier': 'TEAM' } };
    assert.equal(validateProfile(profile, 'cc.altron.mark2', identity), 'TEAM');
    for (const override of [{ expires: '2020-01-01' }, { certificates: ['other'] }, { devices: true },
        { entitlements: { ...profile.entitlements, 'get-task-allow': true } }]) {
        assert.throws(() => validateProfile({ ...profile, ...override }, 'cc.altron.mark2', identity));
    }
    assert.throws(() => validateProfile(profile, 'other.app', identity));
});

test('JWT 使用可验证的 ES256 签名和短有效期，不把私钥内容放入 payload', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const token = createToken({ keyId: 'KEY', issuerId: 'ISSUER', privateKey }, 1000);
    const [header, payload, signature] = token.split('.');
    assert.equal(verify('sha256', Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')), true);
    assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), { iss: 'ISSUER', iat: 1000, exp: 1600, aud: 'appstoreconnect-v1' });
});

test('描述文件的钥匙串通配符转换为应用自己的完整 group，拒绝越权签名', () => {
    const base = { 'com.apple.security.app-sandbox': true };
    const signing = { team: 'TEAM', profile: { entitlements: { 'keychain-access-groups': ['TEAM.*'] } } };
    const actual = createMasEntitlements(base, signing, 'cc.altron.mark2');
    assert.deepEqual(actual['keychain-access-groups'], ['TEAM.cc.altron.mark2']);
    assert.equal(actual['com.apple.application-identifier'], 'TEAM.cc.altron.mark2');
    assert.deepEqual(base, { 'com.apple.security.app-sandbox': true });
    assert.throws(() => createMasEntitlements({}, signing, 'cc.altron.mark2'), /Sandbox/);
    signing.profile.entitlements['keychain-access-groups'] = ['TEAM.other'];
    assert.throws(() => createMasEntitlements(base, signing, 'cc.altron.mark2'), /钥匙串/);
});

test('API 凭据不会被发给非苹果域名，错误保留 Apple 诊断', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mark2-api-test-'));
    try {
        const keyPath = join(directory, 'key.p8');
        const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
        await writeFile(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
        const requests = [];
        const client = await createAppStoreClient({ keyPath, keyId: 'KEY', issuerId: 'ISSUER' }, async (url, options) => {
            requests.push({ url, options });
            return new Response(JSON.stringify({ errors: [{ code: 'INVALID', detail: 'Missing screenshot' }] }), { status: 409 });
        });
        await assert.rejects(client.request('https://example.com/steal'), /非苹果/);
        assert.equal(requests.length, 0);
        await assert.rejects(client.request('/v1/apps'), error => {
            assert.match(error.message, /409.*Missing screenshot/);
            assert.equal(error.requestPath, '/v1/apps');
            assert.deepEqual(error.appStoreErrors, [{ code: 'INVALID', detail: 'Missing screenshot' }]);
            return true;
        });
        assert.ok(requests[0].options.headers.Authorization.startsWith('Bearer '));
    } finally { await rm(directory, { recursive: true, force: true }); }
});

/** 构建查询与提审 API 的可观测替身，不需要真实 Apple 账号或网络。 */
function reviewClient({ processingState = 'VALID', existingItems = null } = {}) {
    const calls = [];
    const client = { calls,
        /** 返回只与当前测试版本有关的 API 资源。 */
        async request(path, options = {}) {
            calls.push({ path, ...options });
            if (path === '/v1/builds') return { data: [{ id: 'build-100', attributes: { processingState } }] };
            if (path.endsWith('/appStoreVersions')) return { data: [{ id: 'version-1', attributes: { appStoreState: 'PREPARE_FOR_SUBMISSION' } }] };
            if (path.endsWith('/reviewSubmissions') && !options.method) return { data: existingItems ? [{ id: 'draft-1', attributes: { state: 'READY_FOR_REVIEW' } }] : [] };
            if (path.endsWith('/items')) return { data: existingItems || [] };
            if (path === '/v1/reviewSubmissions' && options.method === 'POST') return { data: { id: 'draft-1' } };
            return { data: {} };
        } };
    return client;
}

test('只查询指定 macOS 发布版本和构建号，提审默认等待人工发布', async () => {
    const client = reviewClient();
    await submitReview(client, { appId: 'app', version: '1.7.72', buildNumber: '100' });
    const query = client.calls[0].query;
    assert.equal(query['filter[version]'], '100');
    assert.equal(query['filter[preReleaseVersion.version]'], '1.7.72');
    assert.equal(query['filter[preReleaseVersion.platform]'], 'MAC_OS');
    const association = client.calls.find(call => call.path === '/v1/appStoreVersions/version-1');
    assert.equal(association.data.relationships.build.data.id, 'build-100');
    assert.equal(association.data.attributes.releaseType, 'MANUAL');
    assert.deepEqual(client.calls.at(-1).data.attributes, { submitted: true });
});

test('未处理完成的构建及含其他内容的审核草稿不会发生任何远端写入', async () => {
    for (const client of [reviewClient({ processingState: 'PROCESSING' }), reviewClient({ existingItems: [
        { relationships: { appStoreVersion: { data: { id: 'different' } } } } ] })]) {
        await assert.rejects(submitReview(client, { appId: 'app', version: '1.7.72', buildNumber: '100' }));
        assert.equal(client.calls.some(call => call.method), false);
    }
});

test('查不到或匹配多个构建时不会默认选择最新构建', async () => {
    assert.equal(await findBuild({ request: async () => ({ data: [] }) }, 'app', '1.7.72', '100'), null);
    await assert.rejects(findBuild({ request: async () => ({ data: [{}, {}] }) }, 'app', '1.7.72', '100'), /多个/);
});

test('上传验证拒绝其他渠道及被替换的安装包', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mark2-artifact-test-'));
    try {
        const paths = { manifest: join(directory, 'manifest.json'), pkg: join(directory, 'test.pkg') };
        const options = { version: '1.7.72', buildNumber: '100', target: 'aarch64-apple-darwin' };
        await writeFile(paths.pkg, 'original');
        const manifest = { schema: 1, channel: 'github', purchaseModel: 'paid-upfront', bundleId: 'cc.altron.mark2', ...options, pkgSha256: await fileHash(paths.pkg) };
        await writeFile(paths.manifest, JSON.stringify(manifest));
        await assert.rejects(verifyArtifact(paths, options, 'cc.altron.mark2'), /不一致/);
        await writeFile(paths.manifest, JSON.stringify({ ...manifest, channel: 'mas' }));
        await writeFile(paths.pkg, 'replaced');
        await assert.rejects(verifyArtifact(paths, options, 'cc.altron.mark2'), /校验和/);
    } finally { await rm(directory, { recursive: true, force: true }); }
});
