import assert from 'node:assert/strict';
import test from 'node:test';
import { ImageModal } from '../src/components/ImageModal.js';

/** 首次打开保持 100% 时，按下图片即可进入待拖拽状态。 */
test('ImageModal 在初始 100% 状态允许拖拽', () => {
    const modal = {
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        _dragPending: false,
        isDragging: false,
        img: {
            style: {},
            classList: { remove() {} },
        },
        _applyTransform() {},
    };

    ImageModal.prototype._startDrag.call(modal, { clientX: 120, clientY: 80 });
    ImageModal.prototype._onDrag.call(modal, {
        clientX: 140,
        clientY: 95,
        preventDefault() {},
    });

    assert.equal(modal.isDragging, true);
    assert.equal(modal.offsetX, 20);
    assert.equal(modal.offsetY, 15);
});

/** 可拖拽图片始终显示抓取光标，避免 100% 状态误导为点击放大。 */
test('ImageModal 初始状态显示可拖拽光标', () => {
    const modal = { img: { style: {} } };

    ImageModal.prototype._updateCursor.call(modal);

    assert.equal(modal.img.style.cursor, 'grab');
});
