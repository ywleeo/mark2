import { Node } from '@tiptap/core';
import { resolveVideoUrl } from '../utils/videoSrc.js';
import { getAppServices } from '../services/appServices.js';

function getCurrentFile() {
    try {
        return getAppServices().workspace.getCurrentFile() || null;
    } catch (_err) {
        return null;
    }
}

export const VideoBlock = Node.create({
    name: 'videoBlock',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: false,
    // priority 同 mermaidBlock，确保优先解析
    priority: 51,

    addAttributes() {
        return {
            src: { default: '' },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'div[data-type="video-block"]',
                getAttrs: element => ({
                    src: element.getAttribute('data-src') || '',
                }),
            },
        ];
    },

    renderHTML({ node }) {
        const src = typeof node.attrs.src === 'string' ? node.attrs.src : '';
        // 占位 DOM：实际 <video> 由 NodeView 渲染。data-src 留作 parseHTML 回环。
        return [
            'div',
            {
                'data-type': 'video-block',
                'data-src': src,
                class: 'video-block',
            },
        ];
    },

    addNodeView() {
        return ({ node }) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'video-block';
            wrapper.dataset.type = 'video-block';
            wrapper.dataset.src = node.attrs.src || '';

            const rawSrc = node.attrs.src || '';
            const resolvedSrc = resolveVideoUrl(rawSrc, getCurrentFile());

            if (!resolvedSrc) {
                const placeholder = document.createElement('div');
                placeholder.className = 'video-block__placeholder';
                placeholder.textContent = '视频路径为空';
                wrapper.appendChild(placeholder);
                return { dom: wrapper };
            }

            const video = document.createElement('video');
            video.className = 'video-block__player';
            video.src = resolvedSrc;
            video.controls = true;
            video.preload = 'metadata';
            video.playsInline = true;
            video.setAttribute('webkit-playsinline', 'true');
            // 留个原始路径在 dataset 里，导出 / AI 助手等下游需要时能拿到
            video.dataset.originalSrc = rawSrc;
            wrapper.appendChild(video);

            return {
                dom: wrapper,
                // 视频自己的控件（播放/暂停/seek/音量/全屏）由浏览器处理。
                // 不拦的话 PM 会把这些 click/mousedown 当成 doc 上的选区操作，
                // 把光标跳到该节点末尾——表现就是「点一下播放，光标跑到文末」。
                stopEvent(event) {
                    return event.target instanceof HTMLMediaElement;
                },
                // 视频播放时 user-agent shadow DOM 内部会有 attribute/属性变化，
                // 这些跟 doc 结构无关，全部忽略，避免触发不必要的重渲染。
                ignoreMutation: () => true,
            };
        };
    },
});
