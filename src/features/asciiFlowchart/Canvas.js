import { charDisplayWidth } from './charWidth.js';

/**
 * ASCII 流程图绘制画布：以"显示列"为坐标系，CJK 字符占 2 列、ASCII 占 1 列。
 *
 * 内部存储：grid[row][col] = 一个字符 codepoint，或 '' 表示该 cell 被前一个双宽字符占用。
 * 输出时直接 join，被占用的空字符串自然跳过，结果字符串在等宽字体里渲染就严格对齐。
 */
export class Canvas {
    constructor() {
        this.grid = [];
    }

    _ensure(row, col) {
        while (this.grid.length <= row) this.grid.push([]);
        const r = this.grid[row];
        while (r.length <= col) r.push(' ');
    }

    set(row, col, ch) {
        this._ensure(row, col);
        this.grid[row][col] = ch;
    }

    get(row, col) {
        return this.grid[row]?.[col];
    }

    putChar(row, col, ch) {
        const w = charDisplayWidth(ch);
        this.set(row, col, ch);
        if (w === 2) this.set(row, col + 1, '');
        return w;
    }

    putText(row, col, text) {
        let c = col;
        for (const ch of text) c += this.putChar(row, c, ch);
    }

    drawHLine(row, col1, col2, ch = '─') {
        const a = Math.min(col1, col2);
        const b = Math.max(col1, col2);
        for (let c = a; c <= b; c++) {
            if (this.get(row, c) === '') continue;
            this.set(row, c, ch);
        }
    }

    drawVLine(col, row1, row2, ch = '│') {
        const a = Math.min(row1, row2);
        const b = Math.max(row1, row2);
        for (let r = a; r <= b; r++) this.set(r, col, ch);
    }

    toString() {
        return this.grid
            .map(row => row.map(c => (c === undefined ? ' ' : c)).join(''))
            .join('\n')
            .replace(/[ 　]+$/gm, '');
    }
}
