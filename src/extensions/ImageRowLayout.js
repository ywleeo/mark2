import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * 纯图片段落使用 image-paragraph 统一上下留白；含 ≥2 张图时保留 image-row 横排。
 * 链接徽章也是 image 节点，装饰只影响显示，不改变 Markdown 或撤销历史。
 *
 * 不用 CSS :has —— 嵌套 :has(a:has(img)) 在部分 WebView(WKWebView)不生效,
 * 这里用 ProseMirror decoration 精确判定段落内 image 节点数,可靠且随内容更新。
 */
export const ImageRowLayout = Extension.create({
    name: 'imageRowLayout',

    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey('imageRowLayout'),
                props: {
                    decorations(state) {
                        const decorations = [];
                        state.doc.descendants((node, pos) => {
                            if (node.type.name !== 'paragraph') {
                                return undefined; // 继续深入(段落可能在引用/列表里)
                            }
                            let imageCount = 0;
                            let onlyImages = true;
                            node.forEach((child) => {
                                if (child.type.name === 'image') imageCount += 1;
                                else if (child.type.name !== 'hardBreak' && !(child.isText && !child.text.trim())) onlyImages = false;
                            });
                            const classes = [];
                            if (imageCount > 0 && onlyImages) classes.push('image-paragraph');
                            if (imageCount >= 2) classes.push('image-row');
                            if (classes.length) {
                                decorations.push(
                                    Decoration.node(pos, pos + node.nodeSize, { class: classes.join(' ') }),
                                );
                            }
                            return false; // 段落内不再深入
                        });
                        return DecorationSet.create(state.doc, decorations);
                    },
                },
            }),
        ];
    },
});
