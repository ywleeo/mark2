/** 本地正文标题提取，不调用 AI；忽略元数据、注释、代码和 Markdown 排版标记。 */

/** 把行内 Markdown 转为适合侧栏显示的普通文本。 */
function plainText(value) {
    return value.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/<[^>]*>/g, '')
        .replace(/\\([\\`*_{}\[\]()#+.!~>-])/g, '$1')
        .replace(/[*_`~]/g, '')
        .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ').trim();
}

/** 优先返回文章一级标题，否则使用首段标题或首句话；超长文本只截取显示名称。 */
export function extractDocumentTitle(content) {
    if (typeof content !== 'string') return '';
    const lines = content.slice(0, 24000).replace(/^\uFEFF/, '')
        .replace(/^---\s*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/, '')
        .replace(/<!--[\s\S]*?(?:-->|$)/g, '').split(/\r?\n/);
    let fence = null;
    const body = [];
    for (const line of lines) {
        const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
        if (match) {
            if (!fence) fence = match[1][0];
            else if (fence === match[1][0]) fence = null;
            continue;
        }
        if (!fence) body.push(line.trim());
    }
    // 一级标题可出现在引言之后；Setext 一级标题也视为文章标题。
    for (let index = 0; index < body.length; index += 1) {
        const heading = body[index].match(/^#\s+(.+?)(?:\s+#+)?$/);
        if (heading) return plainText(heading[1]).slice(0, 160);
        if (index > 0 && /^={3,}$/.test(body[index]) && body[index - 1]) return plainText(body[index - 1]).slice(0, 160);
    }
    const first = body.findIndex(line => line && !/^(?:[-*_]\s*){3,}$/.test(line) && !/^\[[^\]]+\]:/.test(line));
    if (first < 0) return '';
    const heading = body[first].match(/^#{1,6}\s+(.+?)(?:\s+#+)?$/);
    if (heading) return plainText(heading[1]).slice(0, 160);
    const paragraph = [];
    for (let index = first; index < body.length && body[index]; index += 1) {
        if (index > first && /^[-=]{3,}$/.test(body[index])) break;
        paragraph.push(body[index].replace(/^(?:>\s*|[-+*]\s+|\d+[.)]\s+)(?:\[[ xX]\]\s*)?/, ''));
    }
    const text = plainText(paragraph.join(' '));
    const sentence = text.match(/^.*?[。！？!?](?:[”’」』"])?(?:\s|$)?|^.*?\.(?=\s|$)/);
    return (sentence?.[0]?.trim() || text).slice(0, 160);
}

/** 受限并发的本地标题读取器，避免一次打开侧栏就并行读取全部历史正文。 */
export class DocumentTitleReader {
    /** @param {{readContent:Function,onTitle:Function}} options - 本地内容读取与标题更新回调。 */
    constructor({ readContent, onTitle }) {
        this.readContent = readContent;
        this.onTitle = onTitle;
        this.titles = new Map();
        this.pending = new Set();
        this.queue = [];
        this.active = 0;
        this.destroyed = false;
    }

    /** 缓存正文提取结果；内存中的最新编辑优先于尚未完成的磁盘读取。 */
    update(path, content) {
        const title = extractDocumentTitle(content);
        const previous = this.titles.get(path);
        this.titles.set(path, title);
        if (title !== previous && !this.destroyed) this.onTitle(path, title);
    }

    /** 仅为没有缓存的文档排队读取，失败后保留文件名回退。 */
    ensure(path, cachedTitle = '') {
        if (this.destroyed || this.titles.has(path) || this.pending.has(path)) return;
        if (cachedTitle) { this.titles.set(path, cachedTitle); return; }
        this.pending.add(path);
        this.queue.push(path);
        this.drain();
    }

    /** 最多三个本地读取任务并发；关栏或卸载后旧任务不能回写 UI。 */
    drain() {
        while (!this.destroyed && this.active < 3 && this.queue.length) {
            const path = this.queue.shift();
            this.active += 1;
            void Promise.resolve().then(() => this.readContent(path)).catch(() => '')
                .then(content => {
                    if (!this.destroyed && !this.titles.has(path)) this.update(path, content);
                }).finally(() => {
                    this.pending.delete(path);
                    this.active -= 1;
                    this.drain();
                });
        }
    }

    /** 释放标题任务，未完成读取结果不再通知视图。 */
    destroy() { this.destroyed = true; this.queue = []; }
}
