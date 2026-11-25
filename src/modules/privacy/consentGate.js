/** 第三方数据共享授权状态机：按接收方记录，合并并发确认，支持撤回和拒绝。 */

/** 创建可测试的授权门禁；只有明确同意才放行请求，拒绝不影响本地编辑。 */
export function createConsentGate({ load, save, prompt }) {
    const pending = new Map();
    const denied = new Set();
    let grants = load() || {};
    let revision = 0;

    /** 使用稳定 origin 标识接收方，避免保存 URL 中的凭据、查询参数和文档路径。 */
    const identify = (kind, url) => {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported data recipient');
        return { key: `${kind}:${parsed.origin}`, recipient: parsed.origin };
    };

    /** 取消或撤回产生可识别错误；上层原有请求处理负责显示反馈。 */
    const rejected = () => Object.assign(new Error('Data sharing permission required'), { code: 'sharing-consent-required' });

    return {
        /** 每个接收方只弹一次并发确认；撤回期间完成的旧确认不能重新授予权限。 */
        async ensure(kind, url) {
            const { key, recipient } = identify(kind, url);
            if (grants[key] === true) return;
            if (denied.has(key)) throw rejected();
            if (!pending.has(key)) {
                const startedAt = revision;
                const operation = Promise.resolve().then(() => prompt(kind, recipient)).then(allowed => {
                    if (revision !== startedAt) throw rejected();
                    if (!allowed) { denied.add(key); throw rejected(); }
                    grants = { ...grants, [key]: true };
                    save(grants);
                }).finally(() => { if (pending.get(key) === operation) pending.delete(key); });
                pending.set(key, operation);
            }
            await pending.get(key);
        },
        /** 清除已授予权限，并使仍打开的旧确认失效；未来请求需要重新明确授权。 */
        revoke() {
            revision += 1;
            grants = {};
            denied.clear();
            pending.clear();
            save(grants);
        },
    };
}
