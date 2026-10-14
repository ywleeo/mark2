/** 为本轮原文快照生成可直接引用的块标识，避免模型复述原文或计算字符位置。 */
import MarkdownIt from 'markdown-it';

const parser = new MarkdownIt();

/** 原文引用只在本次执行中有效，位置和校验信息由应用持有。 */
export class DocumentSourceReferences {
    /** 按 Markdown 顶层块建立边界，代码、列表和表格保持完整。 */
    constructor(source) {
        this.source = String(source || '');
        this.prefix = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
        this.references = new Map();
        this.ranges = new Map();
        const offsets = [0];
        for (let index = 0; index < this.source.length; index++) {
            if (this.source[index] === '\n') offsets.push(index + 1);
        }
        this.boundaries = [...new Set([0, ...parser.parse(this.source, {})
            .filter(token => token.level === 0 && token.map)
            .map(token => offsets[token.map[0]]), this.source.length])].sort((a, b) => a - b);
    }

    /** 为已读取的精确范围注册稳定标识，模型无法引用尚未读取的范围。 */
    register(from, to) {
        if (to <= from) return null;
        const key = `${from}:${to}`;
        if (this.ranges.has(key)) return this.ranges.get(key);
        const id = `source-${this.prefix}-${this.references.size + 1}`;
        this.ranges.set(key, id);
        this.references.set(id, { from, to });
        return id;
    }

    /** 返回一次读取的整体引用及各块正文，原文只传输一遍。 */
    read(from, to) {
        const boundaries = [from, ...this.boundaries.filter(offset => offset > from && offset < to), to];
        return {
            source_id: this.register(from, to),
            blocks: boundaries.slice(0, -1).map((offset, index) => ({
                source_id: this.register(offset, boundaries[index + 1]),
                content: this.source.slice(offset, boundaries[index + 1]),
            })),
        };
    }

    /** 转为既有预览/应用协议，未知引用或附带不一致原文均拒绝整批提案。 */
    resolve(edits) {
        if (!Array.isArray(edits) || !edits.length || edits.length > 32) throw new Error('invalid');
        return edits.map(edit => {
            if (!edit?.source_id) return { old_text: edit?.old_text, new_text: edit?.new_text };
            const range = this.references.get(edit.source_id);
            if (!range) throw new Error('unknown_source');
            const oldText = this.source.slice(range.from, range.to);
            if (edit.old_text !== undefined && edit.old_text !== oldText) throw new Error('missing');
            return { old_text: oldText, new_text: edit.new_text, from: range.from };
        });
    }
}
