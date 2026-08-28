import assert from 'node:assert/strict';
import test from 'node:test';
import { createLineGutterAnchor } from '../src/features/aiWriting/AiWritingPositioning.js';

test('AI 写作入口跟随编辑视口左边界而不是固定 sidebar 宽度', () => {
    const lineCoords = { top: 120, bottom: 144 };

    assert.deepEqual(
        createLineGutterAnchor({ left: 261 }, lineCoords),
        { left: 261, top: 120, bottom: 144 },
    );
    assert.deepEqual(
        createLineGutterAnchor({ left: 0 }, lineCoords),
        { left: 0, top: 120, bottom: 144 },
    );
    assert.deepEqual(
        createLineGutterAnchor({ left: 714 }, lineCoords),
        { left: 714, top: 120, bottom: 144 },
    );
});
