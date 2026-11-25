/** 本地与 CI 共用构建入口：只做构建，不发布、上传或改写源码。 */
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, createBuildPlan } from './distribution.mjs';
import { run } from './process.mjs';

/** 剥离渠道参数后原样传递 Tauri CLI 参数，兼容 --target 和 --bundles。 */
export async function main(argv = process.argv.slice(2)) {
    const { values, tokens } = parseArgs({ args: argv, strict: false, allowPositionals: true, tokens: true,
        options: { channel: { type: 'string' }, plan: { type: 'boolean' }, 'frontend-only': { type: 'boolean' },
            'no-updater-artifacts': { type: 'boolean' } } });
    const owned = new Set(['channel', 'plan', 'frontend-only', 'no-updater-artifacts']);
    const consumed = new Set();
    for (const token of tokens) {
        if (token.kind !== 'option' || !owned.has(token.name)) continue;
        consumed.add(token.index);
        if (token.name === 'channel' && !token.inlineValue) consumed.add(token.index + 1);
    }
    const args = argv.filter((_arg, index) => !consumed.has(index));
    const channel = values.channel || process.env.MARK2_DISTRIBUTION || 'github';
    const plan = createBuildPlan({ channel, args, updaterArtifacts: values['no-updater-artifacts'] ? false : undefined });
    if (values.plan) {
        console.log(JSON.stringify({ channel, args: plan.args, frontendDir: plan.frontendDir, targetDir: plan.targetDir }, null, 2));
        return;
    }
    if (values['frontend-only']) {
        await run(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'build'], { env: plan.env });
        return;
    }
    console.log(`[build] channel=${channel}; frontend=${plan.frontendDir}; target=${plan.targetDir}`);
    await run(process.execPath, [resolve(ROOT, 'node_modules/@tauri-apps/cli/tauri.js'), ...plan.args], { env: plan.env });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
