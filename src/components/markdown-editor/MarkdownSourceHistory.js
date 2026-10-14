/** 将完整 Markdown 源码快照与 ProseMirror 撤销事务绑定，保留不可见源码和 frontmatter。 */
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Step, StepMap, StepResult } from '@tiptap/pm/transform';
import { closeHistory } from '@tiptap/pm/history';

export const markdownSourceHistoryKey = new PluginKey('markdownSourceHistory');

/** 无位置变化的可逆源码步骤，和正文替换处于同一个撤销事件。 */
export class MarkdownSourceStep extends Step {
    /** 保存修改前后的源码，不把源码快照写入编辑器 HTML。 */
    constructor(before, after) { super(); this.before = before; this.after = after; }
    /** 源码由插件管理，此步骤不直接改变可见文档节点。 */
    apply(doc) { return StepResult.ok(doc); }
    /** 源码步骤不影响位置映射。 */
    getMap() { return StepMap.empty; }
    /** 撤销时恢复修改前源码。 */
    invert() { return new MarkdownSourceStep(this.after, this.before); }
    /** 此步骤与任何位置映射无关。 */
    map() { return this; }
    /** 序列化符合 ProseMirror 步骤协议。 */
    toJSON() { return { stepType: 'mark2MarkdownSource', before: this.before, after: this.after }; }
    /** 恢复源码步骤。 */
    static fromJSON(_schema, json) { return new MarkdownSourceStep(String(json.before || ''), String(json.after || '')); }
}
// ProseMirror 的自定义步骤协议要求注册唯一类型名，注册仅发生在此模块初始化时。
Step.jsonID('mark2MarkdownSource', MarkdownSourceStep);

/** 保存最近的显式源码快照；普通输入继续沿用源码保留序列化器。 */
export function createMarkdownSourceHistoryPlugin() {
    return new Plugin({
        key: markdownSourceHistoryKey,
        state: {
            init: () => null,
            apply: (transaction, previous) => {
                const step = [...transaction.steps].reverse().find(item => item instanceof MarkdownSourceStep);
                return step ? { source: step.after, documentNode: transaction.doc } : previous;
            },
        },
    });
}

/** 构建一次完整且可撤销的源码修改；前后各隔离历史，防止与手动打字合并。 */
export function createMarkdownSourceReplacement(state, parsedDoc, before, after) {
    return closeHistory(state.tr)
        .replaceWith(0, state.doc.content.size, parsedDoc.content)
        .step(new MarkdownSourceStep(before, after));
}
