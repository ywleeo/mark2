import { ensureMarkdownTrailingEmptyLine } from '../../utils/markdownFormatting.js';

/** 源码位置属性名。 */
const SOURCEPOS_ATTR = 'sourcepos';

/**
 * 解析 Markdown 节点的 `startLine:endLine` 源码位置。
 * @param {object|null} node - ProseMirror 节点。
 * @returns {{startLine:number,endLine:number,key:string}|null} 合法源码位置。
 */
function parseSourcePosition(node) {
    const sourcepos = node?.attrs?.[SOURCEPOS_ATTR];
    if (typeof sourcepos !== 'string') return null;
    const [startLine, endLine] = sourcepos.split(':').map(Number);
    if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
        return null;
    }
    return { startLine, endLine, key: `${startLine}:${endLine}` };
}

/**
 * 创建每一行在源码字符串中的起始偏移。
 * @param {string} source - Markdown 正文源码。
 * @returns {number[]} 零基行起始偏移表。
 */
function createLineOffsets(source) {
    const offsets = [0];
    for (let index = 0; index < source.length; index += 1) {
        if (source[index] === '\n') offsets.push(index + 1);
    }
    return offsets;
}

/**
 * 返回指定结束行末尾、但不包含行终止符的源码偏移。
 * @param {string} source - Markdown 正文源码。
 * @param {number[]} lineOffsets - 行起始偏移表。
 * @param {number} endLine - 一基结束行。
 * @returns {number} 内容结束偏移。
 */
function getContentEndOffset(source, lineOffsets, endLine) {
    const nextLineOffset = lineOffsets[endLine] ?? source.length;
    if (nextLineOffset > 0 && source[nextLineOffset - 1] === '\n') {
        return nextLineOffset - 1;
    }
    return nextLineOffset;
}

/**
 * 归一化会影响 Markdown 输出的节点属性。
 * sourcepos 只服务定位；图片 blob URL 只服务预览，都不属于 Markdown 语义。
 * @param {object|null} node - ProseMirror 节点。
 * @returns {object} 可比较属性。
 */
function getComparableAttrs(node) {
    const attrs = { ...(node?.attrs || {}) };
    delete attrs[SOURCEPOS_ATTR];
    if (node?.type?.name === 'image' && attrs.dataOriginalSrc) {
        attrs.src = attrs.dataOriginalSrc;
    }
    return attrs;
}

/**
 * 比较两个普通 JSON 值。
 * @param {unknown} left - 左值。
 * @param {unknown} right - 右值。
 * @returns {boolean} 是否相等。
 */
function jsonEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * 比较文本节点的 mark 集合。
 * @param {object|null} left - 左文本节点。
 * @param {object|null} right - 右文本节点。
 * @returns {boolean} mark 是否一致。
 */
function marksEqual(left, right) {
    const leftMarks = (left?.marks || []).map(mark => mark?.toJSON?.() ?? {
        type: mark?.type?.name,
        attrs: mark?.attrs || {},
    });
    const rightMarks = (right?.marks || []).map(mark => mark?.toJSON?.() ?? {
        type: mark?.type?.name,
        attrs: mark?.attrs || {},
    });
    return jsonEqual(leftMarks, rightMarks);
}

/**
 * 判断两个节点在 Markdown 语义上是否完全一致。
 * @param {object|null} left - 原始节点。
 * @param {object|null} right - 当前节点。
 * @returns {boolean} 是否可以直接复用原始源码。
 */
export function markdownNodesEqual(left, right) {
    if (!left || !right || left.type?.name !== right.type?.name) return false;
    if (Boolean(left.isText) !== Boolean(right.isText)) return false;
    if (!jsonEqual(getComparableAttrs(left), getComparableAttrs(right))) return false;
    if (!marksEqual(left, right)) return false;
    if (left.isText || right.isText) return left.text === right.text;
    if (left.childCount !== right.childCount) return false;
    for (let index = 0; index < left.childCount; index += 1) {
        if (!markdownNodesEqual(left.child(index), right.child(index))) return false;
    }
    return true;
}

/**
 * 收集结构相同节点中的文本叶子对；结构或格式变化时返回 false。
 * @param {object} originalNode - 原始节点。
 * @param {object} currentNode - 当前节点。
 * @param {Array<{original:string,current:string}>} pairs - 文本叶子输出数组。
 * @returns {boolean} 是否仅发生了文本内容变化。
 */
function collectTextPairs(originalNode, currentNode, pairs) {
    if (!originalNode || !currentNode || originalNode.type?.name !== currentNode.type?.name) return false;
    if (Boolean(originalNode.isText) !== Boolean(currentNode.isText)) return false;
    if (!jsonEqual(getComparableAttrs(originalNode), getComparableAttrs(currentNode))) return false;
    if (!marksEqual(originalNode, currentNode)) return false;

    if (originalNode.isText && currentNode.isText) {
        pairs.push({ original: originalNode.text || '', current: currentNode.text || '' });
        return true;
    }

    if (originalNode.childCount !== currentNode.childCount) return false;
    for (let index = 0; index < originalNode.childCount; index += 1) {
        if (!collectTextPairs(originalNode.child(index), currentNode.child(index), pairs)) return false;
    }
    return true;
}

/**
 * 在不触碰 Markdown 标记的前提下，把纯文本变化应用到原始块源码。
 * 任一文本叶子无法在源码中顺序定位时返回 null，由调用方退回局部序列化。
 * @param {string} rawSource - 原始块源码。
 * @param {object} originalNode - 原始 ProseMirror 节点。
 * @param {object} currentNode - 当前 ProseMirror 节点。
 * @returns {string|null} 局部补丁后的源码。
 */
export function patchTextOnly(rawSource, originalNode, currentNode) {
    const pairs = [];
    if (!collectTextPairs(originalNode, currentNode, pairs) || pairs.length === 0) return null;

    let searchOffset = 0;
    let outputOffset = 0;
    let patched = '';
    let changed = false;

    for (const pair of pairs) {
        if (!pair.original) return null;
        const matchOffset = rawSource.indexOf(pair.original, searchOffset);
        if (matchOffset < 0) return null;
        const matchEnd = matchOffset + pair.original.length;
        if (pair.original !== pair.current) {
            patched += rawSource.slice(outputOffset, matchOffset) + pair.current;
            outputOffset = matchEnd;
            changed = true;
        }
        searchOffset = matchEnd;
    }

    if (!changed) return rawSource;
    return patched + rawSource.slice(outputOffset);
}

/**
 * 从原始 Markdown 和初始 ProseMirror 文档构建顶层块源码布局。
 * @param {string} source - 不含 frontmatter 的 Markdown 正文。
 * @param {object|null} documentNode - 初始 ProseMirror 文档。
 * @returns {object} 可供无损序列化使用的布局快照。
 */
export function createSourceLayout(source, documentNode) {
    const body = typeof source === 'string' ? source : '';
    const lineOffsets = createLineOffsets(body);
    const candidates = [];

    if (documentNode && typeof documentNode.forEach === 'function') {
        documentNode.forEach(node => {
            const position = parseSourcePosition(node);
            if (!position) return;
            const startOffset = lineOffsets[position.startLine - 1];
            if (!Number.isFinite(startOffset)) return;
            const contentEndOffset = getContentEndOffset(body, lineOffsets, position.endLine);
            if (contentEndOffset < startOffset) return;
            candidates.push({
                ...position,
                startOffset,
                contentEndOffset,
                raw: body.slice(startOffset, contentEndOffset),
                node,
            });
        });
    }

    candidates.sort((left, right) => left.startOffset - right.startOffset);
    const entries = [];
    let occupiedUntil = -1;
    for (const candidate of candidates) {
        if (candidate.startOffset < occupiedUntil) continue;
        entries.push({ ...candidate, index: entries.length });
        occupiedUntil = candidate.contentEndOffset;
    }

    const byKey = new Map();
    entries.forEach(entry => {
        const list = byKey.get(entry.key) || [];
        list.push(entry.index);
        byKey.set(entry.key, list);
    });

    const prefix = entries.length > 0 ? body.slice(0, entries[0].startOffset) : body;
    const gaps = entries.map((entry, index) => {
        const nextStart = entries[index + 1]?.startOffset ?? body.length;
        return body.slice(entry.contentEndOffset, nextStart);
    });

    return { source: body, entries, byKey, prefix, gaps };
}

/**
 * 判断节点是否是编辑器为保证可输入性附加的空段落。
 * 原始额外空行已经保存在源码 gap 中，不能把这些占位段落再次输出。
 * @param {object} node - 顶层 ProseMirror 节点。
 * @returns {boolean} 是否应从 Markdown 输出中忽略。
 */
function isSourcePlaceholder(node) {
    return node?.type?.name === 'paragraph'
        && node?.content?.size === 0
        && !parseSourcePosition(node);
}

/**
 * 把单个顶层节点交给现有 MarkdownSerializer，仅重建这个局部容器。
 * @param {object} markdownSerializer - ProseMirror MarkdownSerializer。
 * @param {object} node - 顶层 ProseMirror 节点。
 * @returns {string} 不带外围空行的 Markdown 块。
 */
function serializeSingleBlock(markdownSerializer, node) {
    const schema = node?.type?.schema;
    const docType = schema?.nodes?.doc;
    if (!markdownSerializer?.serialize || !docType?.create) return '';
    const blockDocument = docType.create(null, node);
    return markdownSerializer.serialize(blockDocument)
        .replace(/\u200B/g, '')
        .replace(/^\n+|\n+$/g, '');
}

/**
 * 局部重建块时继承原块范围末尾的换行。
 * markdown-it 的 block map 可能把紧随块的空行纳入 sourcepos，这些换行不在 gap 内，
 * 因此不能随局部序列化器的 trim 一起丢失。
 * @param {string} serialized - 局部重建后的 Markdown 块。
 * @param {string} rawSource - 原块源码。
 * @returns {string} 恢复原边界换行的 Markdown 块。
 */
function preserveTrailingLineBreaks(serialized, rawSource) {
    const trailingLineBreaks = rawSource.match(/(?:\r?\n)+$/)?.[0] || '';
    if (!trailingLineBreaks || serialized.endsWith(trailingLineBreaks)) return serialized;
    return serialized.replace(/(?:\r?\n)+$/, '') + trailingLineBreaks;
}

/**
 * 在重排或新增块边界处使用稳定的 Markdown 块分隔符。
 * @returns {string} 标准块分隔符。
 */
function canonicalSeparator() {
    return '\n\n';
}

/**
 * 取出 gap 中的非空白源码，例如 HTML 注释或引用定义。
 * 外围空行在块结构变化时可由标准分隔符重建，有意义的原始内容则必须保留。
 * @param {string} gap - 两个原始块之间的源码。
 * @returns {string} 去掉外围空白后的有效源码。
 */
function getSignificantGapContent(gap) {
    if (typeof gap !== 'string') return '';
    const first = gap.search(/\S/);
    if (first < 0) return '';
    let last = gap.length - 1;
    while (last >= first && /\s/.test(gap[last])) last -= 1;
    return gap.slice(first, last + 1);
}

/**
 * 在不删除已有空行的前提下，以至少一个标准块间隔追加内容。
 * @param {string} output - 已生成内容。
 * @param {string} chunk - 待追加块。
 * @returns {string} 追加后的内容。
 */
function appendWithCanonicalSeparator(output, chunk) {
    if (!chunk) return output;
    if (!output) return chunk;
    const trailingNewlines = output.match(/\n*$/)?.[0].length || 0;
    const leadingNewlines = chunk.match(/^\n*/)?.[0].length || 0;
    const missingNewlines = Math.max(0, canonicalSeparator().length - trailingNewlines - leadingNewlines);
    return `${output}${'\n'.repeat(missingNewlines)}${chunk}`;
}

/**
 * 在当前原始块前补回尚未输出的有意义 gap 内容。
 * @param {string} output - 已生成内容。
 * @param {string[]} gaps - 原始块间隔。
 * @param {Set<number>} consumedGaps - 已输出的 gap 下标。
 * @param {number} entryIndex - 当前原始块下标。
 * @returns {string} 恢复注释、引用定义等内容后的结果。
 */
function appendSignificantGapsBefore(output, gaps, consumedGaps, entryIndex) {
    let result = output;
    for (let index = 0; index < entryIndex; index += 1) {
        if (consumedGaps.has(index)) continue;
        const significantContent = getSignificantGapContent(gaps[index]);
        if (significantContent) {
            result = appendWithCanonicalSeparator(result, significantContent);
        }
        consumedGaps.add(index);
    }
    return result;
}

/**
 * 源码保留型 Markdown 序列化器。
 * 未修改块复用原文；纯文本编辑在原块上打最小补丁；结构变化仅序列化所属顶层块。
 */
export class SourcePreservingMarkdownSerializer {
    /**
     * @param {object} options - 序列化依赖。
     * @param {object} options.markdownSerializer - 现有 ProseMirror MarkdownSerializer。
     * @param {(node:object)=>string} [options.serializeBlock] - 测试或定制用局部序列化器。
     */
    constructor({ markdownSerializer, serializeBlock = null } = {}) {
        this.markdownSerializer = markdownSerializer;
        this.serializeBlock = typeof serializeBlock === 'function'
            ? serializeBlock
            : node => serializeSingleBlock(this.markdownSerializer, node);
        this.layout = createSourceLayout('', null);
    }

    /**
     * 以新加载的源码和文档树重置基线。
     * @param {string} source - 不含 frontmatter 的 Markdown 正文。
     * @param {object|null} documentNode - 对应的 ProseMirror 文档。
     */
    reset(source, documentNode) {
        this.layout = createSourceLayout(source, documentNode);
    }

    /**
     * 导出当前内存快照，供标签页切换时连同 EditorState 一并保存。
     * @returns {object} 不可变节点引用组成的轻量快照。
     */
    snapshot() {
        return this.layout;
    }

    /**
     * 恢复标签页对应的源码布局快照。
     * @param {object|null} snapshot - snapshot() 产生的快照。
     */
    restore(snapshot) {
        if (snapshot?.entries && snapshot?.byKey && Array.isArray(snapshot?.gaps)) {
            this.layout = snapshot;
        }
    }

    /**
     * 将当前文档输出为 Markdown，同时保留所有未编辑源码。
     * @param {object|null} documentNode - 当前 ProseMirror 文档。
     * @returns {string} 完整 Markdown 正文。
     */
    serialize(documentNode) {
        const { entries, byKey, prefix, gaps } = this.layout;
        const usedEntries = new Set();
        const consumedGaps = new Set();
        const blocks = [];

        if (documentNode && typeof documentNode.forEach === 'function') {
            documentNode.forEach(node => {
                if (isSourcePlaceholder(node)) return;

                const sourcePosition = parseSourcePosition(node);
                const candidateIndexes = sourcePosition ? (byKey.get(sourcePosition.key) || []) : [];
                const entryIndex = candidateIndexes.find(index => !usedEntries.has(index));
                const entry = Number.isInteger(entryIndex) ? entries[entryIndex] : null;
                if (entry) usedEntries.add(entry.index);

                let markdown = '';
                if (entry && markdownNodesEqual(entry.node, node)) {
                    markdown = entry.raw;
                } else if (entry) {
                    markdown = patchTextOnly(entry.raw, entry.node, node)
                        ?? preserveTrailingLineBreaks(this.serializeBlock(node), entry.raw);
                } else {
                    markdown = this.serializeBlock(node);
                }

                if (markdown || node?.content?.size > 0) {
                    blocks.push({ markdown, entryIndex: entry?.index ?? null });
                }
            });
        }

        // 即使文档没有可见块，prefix 也可能包含注释或引用定义，不能丢弃。
        let output = prefix;
        let previous = null;
        for (const block of blocks) {
            if (previous) {
                const isOriginalNeighbour = Number.isInteger(previous.entryIndex)
                    && Number.isInteger(block.entryIndex)
                    && block.entryIndex === previous.entryIndex + 1;
                if (isOriginalNeighbour) {
                    output += gaps[previous.entryIndex];
                    consumedGaps.add(previous.entryIndex);
                } else {
                    if (Number.isInteger(block.entryIndex)) {
                        output = appendSignificantGapsBefore(
                            output,
                            gaps,
                            consumedGaps,
                            block.entryIndex
                        );
                    }
                    output = appendWithCanonicalSeparator(output, block.markdown);
                    previous = block;
                    continue;
                }
            } else {
                if (Number.isInteger(block.entryIndex)) {
                    output = appendSignificantGapsBefore(
                        output,
                        gaps,
                        consumedGaps,
                        block.entryIndex
                    );
                }
                if (output && block.markdown && !output.endsWith('\n')) {
                    output = appendWithCanonicalSeparator(output, block.markdown);
                    previous = block;
                    continue;
                }
            }
            output += block.markdown;
            previous = block;
        }

        if (entries.length > 0) {
            for (let index = 0; index < entries.length - 1; index += 1) {
                if (consumedGaps.has(index)) continue;
                const significantContent = getSignificantGapContent(gaps[index]);
                if (significantContent) {
                    output = appendWithCanonicalSeparator(output, significantContent);
                }
            }
            const suffix = gaps[entries.length - 1] || '';
            if (suffix) output += suffix;
        }

        return ensureMarkdownTrailingEmptyLine(output);
    }
}
