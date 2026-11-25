/** 发布进程适配：参数使用数组传递，不经过 shell，不输出密钥环境变量。 */
import { spawn } from 'node:child_process';
import { ROOT } from './distribution.mjs';

/** 执行本机工具；捕获模式仅用于解析结果，默认实时显示构建日志。 */
export function run(command, args = [], { env = process.env, cwd = ROOT, capture = false, input } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, env, shell: false,
            stdio: capture ? [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] : 'inherit' });
        if (input !== undefined) child.stdin.end(input);
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', chunk => { stdout += chunk; });
        child.stderr?.on('data', chunk => { stderr += chunk; });
        child.on('error', reject);
        child.on('close', (code, signal) => {
            if (code === 0) resolve(stdout);
            else reject(new Error(`${command} 失败（${signal || code}）${capture ? `：${stderr.trim()}` : ''}`));
        });
    });
}
