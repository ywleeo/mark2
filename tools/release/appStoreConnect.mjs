/** App Store Connect API：精确定位版本和构建，禁止隐式选择“最新构建”提审。 */
import { readFile } from 'node:fs/promises';
import { sign } from 'node:crypto';

const API = 'https://api.appstoreconnect.apple.com';

/** 生成短期 ES256 JWT；私钥和 token 不写入日志或发布报告。 */
export function createToken({ keyId, issuerId, privateKey }, now = Math.floor(Date.now() / 1000)) {
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss: issuerId, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' })).toString('base64url');
    const body = `${header}.${payload}`;
    return `${body}.${sign('sha256', Buffer.from(body), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

/** 创建可注入 fetch 的客户端，接口失败保留苹果的错误码和定位字段。 */
export async function createAppStoreClient(config, fetchImpl = fetch) {
    if (!config.keyId || !config.issuerId || !config.keyPath) throw new Error('请配置 App Store Connect keyId、issuerId 和 keyPath');
    const privateKey = await readFile(config.keyPath, 'utf8');
    /** 只允许调用苹果 API；不自动重试 POST，避免网络超时后重复提交。 */
    const request = async (path, { method = 'GET', data, query } = {}) => {
        const url = new URL(path, API);
        if (url.origin !== API) throw new Error('拒绝向非苹果域名发送 App Store Connect 凭据');
        for (const [key, value] of Object.entries(query || {})) if (value !== undefined) url.searchParams.set(key, value);
        const response = await fetchImpl(url, { method, signal: AbortSignal.timeout(60000),
            headers: { Authorization: `Bearer ${createToken({ ...config, privateKey })}`, 'Content-Type': 'application/json' },
            body: data ? JSON.stringify({ data }) : undefined });
        const text = await response.text();
        const result = text ? JSON.parse(text) : {};
        if (!response.ok) {
            // Apple 将可操作的提审阻断项放在关联错误中，保留结构供发布日志定位，不输出鉴权信息。
            const error = new Error(`App Store Connect ${response.status}：${(result.errors || []).map(item => `${item.code}: ${item.detail || item.title}`).join('; ')}`);
            error.appStoreErrors = result.errors || [];
            error.requestPath = url.pathname;
            throw error;
        }
        return result;
    };
    return { request };
}

/** 精确查询 Bundle ID；此接口只读，状态命令不会创建远端资源。 */
export async function findApp(client, bundleId) {
    const { data } = await client.request('/v1/apps', { query: { 'filter[bundleId]': bundleId } });
    if (data?.length !== 1) throw new Error(`App Store Connect 中未找到唯一应用：${bundleId}`);
    return data[0];
}

/** 查询指定 macOS 发布版本和构建号，避免混入 iOS 或另一版本的上传。 */
export async function findBuild(client, appId, version, buildNumber) {
    const { data } = await client.request('/v1/builds', { query: { 'filter[app]': appId,
        'filter[preReleaseVersion.platform]': 'MAC_OS', 'filter[preReleaseVersion.version]': version,
        'filter[version]': buildNumber, limit: '2' } });
    if (data?.length > 1) throw new Error('发现多个匹配构建，无法安全选择');
    return data?.[0] || null;
}

/** 关联明确指定的有效构建，再通过苹果的 Review Submission API 提审。 */
export async function submitReview(client, { appId, version, buildNumber, autoRelease = false }) {
    const build = await findBuild(client, appId, version, buildNumber);
    if (!build || build.attributes.processingState !== 'VALID' || build.attributes.expired) throw new Error('指定构建尚未处理成功或已过期；请先使用 status 检查');
    const versions = await client.request(`/v1/apps/${appId}/appStoreVersions`, { query: {
        'filter[platform]': 'MAC_OS', 'filter[versionString]': version } });
    if (versions.data?.length !== 1) throw new Error('请先在 App Store Connect 创建对应的 macOS 版本，并完善截图、隐私信息、分级和审核备注');
    const storeVersion = versions.data[0];
    const state = storeVersion.attributes.appStoreState || storeVersion.attributes.appVersionState;
    if (!['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'READY_FOR_REVIEW'].includes(state)) {
        throw new Error(`该版本当前不能重新提交审核：${state}`);
    }
    const submissions = await client.request(`/v1/apps/${appId}/reviewSubmissions`, { query: { 'filter[platform]': 'MAC_OS', limit: '200' } });
    if (submissions.links?.next) throw new Error('审核记录超出单次检查范围，请先在 App Store Connect 确认审核状态');
    const active = submissions.data.filter(item => item.attributes.state !== 'COMPLETE');
    if (active.length > 1 || active.some(item => item.attributes.state !== 'READY_FOR_REVIEW')) throw new Error('已有进行中的审核，请先在 App Store Connect 处理');
    let submission = active[0];
    if (submission) {
        const { data: items, links } = await client.request(`/v1/reviewSubmissions/${submission.id}/items`, { query: { include: 'appStoreVersion', limit: '200' } });
        if (links?.next) throw new Error('已有审核草稿内容过多，请先在 App Store Connect 确认');
        if (items.length && (items.length !== 1 || items[0].relationships?.appStoreVersion?.data?.id !== storeVersion.id)) {
            throw new Error('已有审核草稿包含其他内容，请先在 App Store Connect 确认，工具不会覆盖它');
        }
    }
    await client.request(`/v1/appStoreVersions/${storeVersion.id}`, { method: 'PATCH', data: {
        type: 'appStoreVersions', id: storeVersion.id, attributes: { releaseType: autoRelease ? 'AFTER_APPROVAL' : 'MANUAL' },
        relationships: { build: { data: { type: 'builds', id: build.id } } } } });
    if (!submission) {
        ({ data: submission } = await client.request('/v1/reviewSubmissions', { method: 'POST', data: {
            type: 'reviewSubmissions', attributes: { platform: 'MAC_OS' }, relationships: { app: { data: { type: 'apps', id: appId } } } } }));
    }
    const { data: items } = await client.request(`/v1/reviewSubmissions/${submission.id}/items`);
    if (!items.length) await client.request('/v1/reviewSubmissionItems', { method: 'POST', data: {
        type: 'reviewSubmissionItems', relationships: { reviewSubmission: { data: { type: 'reviewSubmissions', id: submission.id } },
            appStoreVersion: { data: { type: 'appStoreVersions', id: storeVersion.id } } } } });
    return client.request(`/v1/reviewSubmissions/${submission.id}`, { method: 'PATCH', data: {
        type: 'reviewSubmissions', id: submission.id, attributes: { submitted: true } } });
}
