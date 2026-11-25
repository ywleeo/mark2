/** MAS 签名预检和 plist 适配；证书私钥始终保留在 macOS 钥匙串中。 */
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { run } from './process.mjs';

/** 从 security 的身份输出提取可传给 codesign / productbuild 的证书指纹。 */
export function parseIdentities(output) {
    return [...output.matchAll(/^\s*\d+\)\s+([A-Fa-f\d]{40})\s+"([^"]+)"/gm)]
        .map(([, hash, name]) => ({ hash: hash.toUpperCase(), name }));
}

/** 明确选择唯一可用证书，多个候选时要求在本地配置中指定，避免签错团队。 */
export function chooseIdentity(identities, requested, pattern) {
    const matches = identities.filter(item => pattern.test(item.name)
        && (!requested || item.hash === requested.toUpperCase() || item.name === requested));
    if (matches.length !== 1) throw new Error(matches.length ? '存在多个签名证书，请在配置中指定 signingIdentity / installerIdentity' : '未找到有效的商店分发签名证书');
    return matches[0];
}

/** 使用系统自带 Python 解析 plist；只返回调用方请求的数据，不打印原始凭据。 */
export async function parsePlist(xml) {
    return JSON.parse(await run('python3', ['-c', 'import plistlib,json,sys; print(json.dumps(plistlib.loads(sys.stdin.buffer.read())))'],
        { capture: true, input: xml }));
}

/** 将 JSON 权限写为 XML plist；输入不经 shell 展开。 */
export async function encodePlist(value) {
    return run('python3', ['-c', 'import plistlib,json,sys; sys.stdout.buffer.write(plistlib.dumps(json.load(sys.stdin)))'],
        { capture: true, input: JSON.stringify(value) });
}

/** 解码 provisioning profile，只保留匹配和有效期验证所需字段。 */
export async function readProfile(path) {
    const xml = await run('/usr/bin/security', ['cms', '-D', '-i', path], { capture: true });
    const source = 'import plistlib,json,sys,hashlib; p=plistlib.loads(sys.stdin.buffer.read()); '
        + 'print(json.dumps({"path":sys.argv[1],"uuid":p.get("UUID"),"expires":p["ExpirationDate"].isoformat()+"Z",'
        + '"entitlements":p.get("Entitlements",{}),"devices":bool(p.get("ProvisionedDevices")),"allDevices":p.get("ProvisionsAllDevices",False),'
        + '"certificates":[hashlib.sha1(c).hexdigest().upper() for c in p.get("DeveloperCertificates",[])]}))';
    return JSON.parse(await run('python3', ['-c', source, path], { capture: true, input: xml }));
}

/** 检查 App ID、证书和 profile 的一致性，不把过期或开发描述文件当作 MAS 分发文件。 */
export function validateProfile(profile, bundleId, identity, now = Date.now()) {
    const ent = profile.entitlements;
    const appId = ent['com.apple.application-identifier'] || ent['application-identifier'];
    const team = ent['com.apple.developer.team-identifier'];
    if (!team || appId !== `${team}.${bundleId}`) throw new Error('描述文件的 App ID / Team 与应用不匹配，请使用精确匹配的 MAS 描述文件');
    if (!Number.isFinite(Date.parse(profile.expires)) || Date.parse(profile.expires) <= now) throw new Error('描述文件已过期或有效期无效');
    if (ent['get-task-allow'] || ent['com.apple.security.get-task-allow'] || profile.devices || profile.allDevices) throw new Error('需要 Mac App Store Distribution 描述文件，不能使用开发或站外分发描述文件');
    if (!profile.certificates.includes(identity.hash)) throw new Error('应用签名证书不在描述文件的允许列表中');
    return team;
}

/** 自动查找当前用户安装的描述文件；不递归扫描用户文档目录。 */
export async function findProfiles() {
    const paths = [];
    for (const directory of ['Library/MobileDevice/Provisioning Profiles', 'Library/Developer/Xcode/UserData/Provisioning Profiles']) {
        const root = resolve(homedir(), directory);
        for (const name of await readdir(root).catch(() => [])) {
            if (name.endsWith('.provisionprofile')) paths.push(resolve(root, name));
        }
    }
    return paths;
}

/** 本机签名依赖预检；自动发现只接受唯一、有效且属于同一团队的组合。 */
export async function inspectSigning(config, bundleId) {
    const appIds = parseIdentities(await run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { capture: true }));
    const installerIds = parseIdentities(await run('/usr/bin/security', ['find-identity', '-v', '-p', 'macappstore'], { capture: true }));
    const identity = chooseIdentity(appIds, config.signingIdentity, /^(Apple Distribution|Mac App Distribution|3rd Party Mac Developer Application):/);
    const installer = chooseIdentity(installerIds, config.installerIdentity, /^(Mac Installer Distribution|3rd Party Mac Developer Installer):/);
    const profiles = config.profile ? [config.profile] : await findProfiles();
    const valid = [];
    for (const path of profiles) {
        try {
            const profile = await readProfile(path);
            const team = validateProfile(profile, bundleId, identity);
            if (!installer.name.endsWith(`(${team})`)) throw new Error('安装器证书与应用证书不属于同一团队');
            valid.push({ identity, installer, profile, team });
        } catch (error) {
            if (config.profile) throw error;
        }
    }
    valid.sort((a, b) => Date.parse(b.profile.expires) - Date.parse(a.profile.expires));
    if (!valid.length) throw new Error('未找到匹配当前证书和 App ID 的有效 MAS 描述文件');
    return valid[0];
}
