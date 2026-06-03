import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * 同一段落含 ≥2 张图(image node,含 [![](x)](y) 这种带 link mark 的徽章)时,
 * 给该段落加 class `image-row`,CSS 据此左右横排。
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
                            node.forEach((child) => {
                                if (child.type.name === 'image') imageCount += 1;
                            });
                            if (imageCount >= 2) {
                                decorations.push(
                                    Decoration.node(pos, pos + node.nodeSize, { class: 'image-row' }),
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
