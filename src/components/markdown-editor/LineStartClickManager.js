import { TextSelection } from '@tiptap/pm/state';

/**
 * 修正 contenteditable 在视觉行首左侧点击时把光标落到上一行行尾的问题。
 */
export class LineStartClickManager {
    constructor({ editor }) {
        this.editor = editor;
        this.mouseDownHandler = (event) => this.handleMouseDown(event);
    }

    setup() {
        this.editor?.view?.dom?.addEventListener('mousedown', this.mouseDownHandler, true);
    }

    destroy() {
        this.editor?.view?.dom?.removeEventListener('mousedown', this.mouseDownHandler, true);
    }

    handleMouseDown(event) {
        const view = this.editor?.view;
        if (!view || view.isDestroyed || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
            return;
        }
        const target = event.target;
        if (target?.closest?.('a, button, input, textarea, select, [contenteditable="false"]')) return;

        const lineStart = this.findClickedLineStart(event.clientX, event.clientY);
        if (lineStart == null) return;

        event.preventDefault();
        const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, lineStart));
        view.dispatch(tr);
        view.focus();
    }

    findClickedLineStart(clientX, clientY) {
        const view = this.editor?.view;
        const state = this.editor?.state;
        const hit = view?.posAtCoords?.({ left: clientX, top: clientY });
        if (!view || !state || hit?.pos == null) return null;

        const searchFrom = Math.max(0, hit.pos - 120);
        const searchTo = Math.min(state.doc.content.size, hit.pos + 240);
        const characterRectStart = this.findLineStartByCharacterRect(searchFrom, searchTo, clientX, clientY);
        if (characterRectStart != null) return characterRectStart;

        let best = null;

        for (let pos = searchFrom; pos <= searchTo; pos += 1) {
            const candidate = this.getVisualLineStart(pos, clientY);
            if (!candidate) continue;
            const distanceY = Math.abs(candidate.middle - clientY);
            if (distanceY > Math.max(8, candidate.height * 0.55)) continue;
            if (clientX > candidate.left + 10) continue;
            if (!best || distanceY < best.distanceY || candidate.left < best.left) {
                best = { ...candidate, distanceY };
            }
        }

        return best?.pos ?? null;
    }

    findLineStartByCharacterRect(searchFrom, searchTo, clientX, clientY) {
        let best = null;
        for (let pos = searchFrom; pos <= searchTo; pos += 1) {
            const rect = this.getCharacterRect(pos);
            if (!rect) continue;
            const middle = (rect.top + rect.bottom) / 2;
            const sameLine = clientY >= rect.top - 3 && clientY <= rect.bottom + 3;
            if (!sameLine || clientX > rect.left + 10) continue;
            if (!best || rect.left < best.left || Math.abs(middle - clientY) < best.distanceY) {
                best = {
                    pos,
                    left: rect.left,
                    distanceY: Math.abs(middle - clientY),
                };
            }
        }
        return best?.pos ?? null;
    }

    getVisualLineStart(pos, targetY) {
        const view = this.editor?.view;
        const state = this.editor?.state;
        if (!view || !state) return null;

        let current;
        try {
            current = view.coordsAtPos(pos, 1);
        } catch {
            return null;
        }

        const middle = (current.top + current.bottom) / 2;
        if (Math.abs(middle - targetY) > Math.max(12, (current.bottom - current.top) * 0.8)) {
            return null;
        }

        const $pos = state.doc.resolve(pos);
        const blockStart = $pos.parent.isTextblock ? $pos.start() : Math.max(0, pos - 1);
        const scanStart = Math.max(blockStart, pos - 1000);
        let lineStart = pos;
        let left = current.left;
        let foundSameLine = false;

        for (let cursor = pos; cursor >= scanStart; cursor -= 1) {
            try {
                const coords = view.coordsAtPos(cursor, 1);
                const cursorMiddle = (coords.top + coords.bottom) / 2;
                const sameLine = Math.abs(cursorMiddle - middle) <= 4
                    || (coords.top <= middle && coords.bottom >= middle);
                if (sameLine) {
                    foundSameLine = true;
                    if (coords.left <= left) {
                        left = coords.left;
                        lineStart = cursor;
                    }
                    continue;
                }
                if (foundSameLine) break;
            } catch (_) {
                if (foundSameLine) break;
            }
        }

        return {
            pos: lineStart,
            left,
            middle,
            height: current.bottom - current.top,
        };
    }

    getCharacterRect(pos) {
        const view = this.editor?.view;
        if (!view) return null;
        let domPos;
        try {
            domPos = view.domAtPos(pos);
        } catch {
            return null;
        }
        const target = this.findNextTextPosition(domPos.node, domPos.offset);
        if (!target) return null;

        const range = document.createRange();
        range.setStart(target.node, target.offset);
        range.setEnd(target.node, target.offset + 1);
        const rect = Array.from(range.getClientRects()).find(item => item.width > 0 && item.height > 0);
        range.detach?.();
        return rect || null;
    }

    findNextTextPosition(node, offset) {
        if (!node) return null;
        if (node.nodeType === Node.TEXT_NODE && offset < node.nodeValue.length) {
            return { node, offset };
        }

        const root = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        if (!root) return null;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let textNode = null;
        while ((textNode = walker.nextNode())) {
            if (textNode.nodeValue) return { node: textNode, offset: 0 };
        }
        return null;
    }
}
