/**
 * 卡片文本样式控制器。
 * 负责字号/行高/字重/垂直对齐/自动排版的状态与应用。
 * 持有 sidebar 引用以读取 DOM 节点(cardElement / cardTextElement / cardBodyElement)
 * 和 UI 按钮引用(fontDecreaseButton 等),并在 applyXxx 时修改 DOM。
 */

const FONT_SCALE_MIN = 0.3;
const FONT_SCALE_MAX = 1.8;
export const FONT_SCALE_STEP = 0.1;
const LINE_HEIGHT_SCALE_MIN = 0.8;
const LINE_HEIGHT_SCALE_MAX = 1.6;
export const LINE_HEIGHT_SCALE_STEP = 0.1;
const FONT_WEIGHT_MIN = 300;
const FONT_WEIGHT_MAX = 800;
export const FONT_WEIGHT_STEP = 100;

export class CardTextStyleController {
    constructor(sidebar) {
        this.sidebar = sidebar;
        this.fontScale = 1;
        this.lineHeightScale = 1;
        this.baseFontSize = null;
        this.baseLineHeightRatio = null;
        this.fontWeight = 400;
        this.fontWeightModified = false;
        this.verticalAlign = 'center';
        this.autoFitEnabled = true;
    }

    // --- 字号 ---
    adjustFontScale(delta) {
        this.setFontScale(this.fontScale + delta, true);
    }

    setFontScale(value, isManual = false) {
        const next = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Number(value) || 1));
        const changed = Math.abs(next - this.fontScale) > 0.001;
        this.fontScale = next;
        if (changed) {
            this.applyFontScale();
        } else {
            this.applyLineHeightScale();
        }
        if (isManual && this.autoFitEnabled) {
            this.autoFitEnabled = false;
        }
        this.syncTextControlState();
    }

    applyFontScale() {
        const textEl = this.sidebar.cardTextElement;
        if (!textEl) return;
        let baseSize = this.baseFontSize;
        if (!Number.isFinite(baseSize)) {
            const computed = window.getComputedStyle(textEl);
            const parsed = parseFloat(computed.fontSize);
            if (Number.isFinite(parsed)) {
                baseSize = parsed;
                this.baseFontSize = parsed;
            } else {
                baseSize = 16;
                this.baseFontSize = baseSize;
            }
        }
        const scaled = baseSize * this.fontScale;
        textEl.style.fontSize = `${scaled}px`;
        this.applyLineHeightScale();
    }

    // --- 行高 ---
    adjustLineHeightScale(delta) {
        this.setLineHeightScale(this.lineHeightScale + delta, true);
    }

    setLineHeightScale(value, isManual = false) {
        const next = Math.min(LINE_HEIGHT_SCALE_MAX, Math.max(LINE_HEIGHT_SCALE_MIN, Number(value) || 1));
        const changed = Math.abs(next - this.lineHeightScale) > 0.001;
        this.lineHeightScale = next;
        if (changed) {
            this.applyLineHeightScale();
        }
        if (isManual && this.autoFitEnabled) {
            this.autoFitEnabled = false;
        }
        this.syncTextControlState();
    }

    applyLineHeightScale() {
        const textEl = this.sidebar.cardTextElement;
        if (!textEl) return;
        const baseFont = this.baseFontSize || (parseFloat(window.getComputedStyle(textEl).fontSize) / this.fontScale) || 16;
        const ratio = this.baseLineHeightRatio ?? 1.6;
        const px = baseFont * this.fontScale * ratio * this.lineHeightScale;
        textEl.style.lineHeight = `${px}px`;
    }

    // --- 字重 ---
    adjustFontWeight(delta) {
        this.setFontWeight((this.fontWeight || 400) + delta);
    }

    setFontWeight(value) {
        if (!Number.isFinite(value)) return;
        const rounded = Math.round(value / FONT_WEIGHT_STEP) * FONT_WEIGHT_STEP;
        const next = Math.min(FONT_WEIGHT_MAX, Math.max(FONT_WEIGHT_MIN, rounded));
        if (next === this.fontWeight) return;
        this.fontWeight = next;
        this.fontWeightModified = true;
        this.applyFontWeight();
        this.syncTextControlState();
    }

    applyFontWeight() {
        const textEl = this.sidebar.cardTextElement;
        if (!textEl) return;
        const weight = Number.isFinite(this.fontWeight) ? this.fontWeight : 400;
        textEl.style.fontWeight = `${weight}`;
    }

    // --- 垂直对齐 ---
    toggleVerticalAlign() {
        this.setVerticalAlign(this.verticalAlign === 'center' ? 'top' : 'center');
    }

    setVerticalAlign(mode) {
        const next = mode === 'center' ? 'center' : 'top';
        if (next === this.verticalAlign) return;
        this.verticalAlign = next;
        this.applyVerticalAlign();
        this.syncTextControlState();
    }

    applyVerticalAlign() {
        const cardEl = this.sidebar.cardElement;
        if (!cardEl) return;
        if (this.verticalAlign === 'center') {
            cardEl.classList.add('card-preview-card--align-center');
        } else {
            cardEl.classList.remove('card-preview-card--align-center');
        }
    }

    // --- 自动排版 ---
    toggleAutoFit() {
        this.autoFitEnabled = !this.autoFitEnabled;
        this.syncTextControlState();
        if (this.autoFitEnabled && this.sidebar.currentContent) {
            this.autoFitContent();
        }
    }

    autoFitContent() {
        const { cardTextElement, cardElement, currentContent } = this.sidebar;
        if (!cardTextElement || !currentContent) return;

        // 重置到默认缩放值
        this.fontScale = 1;
        this.lineHeightScale = 1;
        this.applyFontScale();
        cardElement.classList.remove('card-preview-card--auto-fit');

        // 等待 DOM 更新后检测溢出(双重 rAF 确保布局重计算完成)
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this._adjustToFit();
            });
        });
    }

    /**
     * 递减调整字号和行距直到内容不溢出
     */
    _adjustToFit() {
        const { cardElement, cardBodyElement, cardTextElement } = this.sidebar;
        const isOverflowing = () => {
            const cardHeight = cardElement.clientHeight;
            const bodyStyle = window.getComputedStyle(cardBodyElement);
            const paddingTop = parseFloat(bodyStyle.paddingTop) || 0;
            const paddingBottom = parseFloat(bodyStyle.paddingBottom) || 0;
            const availableHeight = cardHeight - paddingTop - paddingBottom;
            const contentHeight = cardTextElement.scrollHeight;
            return contentHeight > availableHeight + 2;
        };

        if (!isOverflowing()) {
            this.syncTextControlState();
            return;
        }

        // 触发了自动调整,增加上下 padding 留出水印位置
        cardElement.classList.add('card-preview-card--auto-fit');

        const STEP = 0.05;
        let iterations = 0;
        const MAX_ITERATIONS = 50;

        while (isOverflowing() && iterations < MAX_ITERATIONS) {
            iterations++;
            if (this.fontScale > FONT_SCALE_MIN + STEP) {
                this.fontScale = Math.max(FONT_SCALE_MIN, this.fontScale - STEP);
                this.applyFontScale();
                continue;
            }
            if (this.lineHeightScale > LINE_HEIGHT_SCALE_MIN + STEP) {
                this.lineHeightScale = Math.max(LINE_HEIGHT_SCALE_MIN, this.lineHeightScale - STEP);
                this.applyLineHeightScale();
                continue;
            }
            break;
        }

        this.syncTextControlState();
    }

    // --- 从 markdown 同步基础字体属性 ---
    syncTextStylesFromMarkdown() {
        const textEl = this.sidebar.cardTextElement;
        if (!textEl) return;
        try {
            const markdownContent =
                document.querySelector('.markdown-pane .tiptap-editor') ||
                document.querySelector('.tiptap-editor') ||
                document.querySelector('.markdown-pane .markdown-content') ||
                document.querySelector('.markdown-content');
            if (!markdownContent) return;

            const styles = window.getComputedStyle(markdownContent);
            if (!this.fontWeightModified) {
                const parsedWeight = parseInt(styles.fontWeight, 10);
                if (Number.isFinite(parsedWeight)) {
                    this.fontWeight = Math.min(FONT_WEIGHT_MAX, Math.max(FONT_WEIGHT_MIN, parsedWeight));
                } else if (!Number.isFinite(this.fontWeight)) {
                    this.fontWeight = 400;
                }
            }
            textEl.style.fontFamily = styles.fontFamily;
            this.applyFontWeight();
            textEl.style.letterSpacing = styles.letterSpacing;
            // 不同步 color,由 CSS 的 data-card-theme 控制
            const parsedSize = parseFloat(styles.fontSize);
            if (Number.isFinite(parsedSize)) {
                this.baseFontSize = parsedSize;
            }
            const ratio = this.getLineHeightRatio(styles.lineHeight, this.baseFontSize);
            if (Number.isFinite(ratio)) {
                this.baseLineHeightRatio = ratio;
            } else if (!Number.isFinite(this.baseLineHeightRatio)) {
                this.baseLineHeightRatio = 1.6;
            }
            this.applyFontScale();
            this.applyFontWeight();
            this.applyVerticalAlign();
            this.syncTextControlState();
        } catch (error) {
            console.warn('[CardTextStyleController] 同步 markdown 文本样式失败', error);
        }
    }

    // --- UI 按钮状态同步 ---
    syncTextControlState() {
        const s = this.sidebar;
        if (s.fontDecreaseButton) {
            s.fontDecreaseButton.disabled = this.fontScale <= FONT_SCALE_MIN + 0.001;
        }
        if (s.fontIncreaseButton) {
            s.fontIncreaseButton.disabled = this.fontScale >= FONT_SCALE_MAX - 0.001;
        }
        if (s.lineHeightDecreaseButton) {
            s.lineHeightDecreaseButton.disabled = this.lineHeightScale <= LINE_HEIGHT_SCALE_MIN + 0.001;
        }
        if (s.lineHeightIncreaseButton) {
            s.lineHeightIncreaseButton.disabled = this.lineHeightScale >= LINE_HEIGHT_SCALE_MAX - 0.001;
        }
        if (s.fontWeightDecreaseButton) {
            s.fontWeightDecreaseButton.disabled = this.fontWeight <= FONT_WEIGHT_MIN;
        }
        if (s.fontWeightIncreaseButton) {
            s.fontWeightIncreaseButton.disabled = this.fontWeight >= FONT_WEIGHT_MAX;
        }
        if (s.alignToggleButton) {
            const isCenter = this.verticalAlign === 'center';
            s.alignToggleButton.classList.toggle('is-active', isCenter);
            s.alignToggleButton.setAttribute('aria-pressed', String(isCenter));
            const alignTitle = isCenter ? '切换为顶部对齐' : '切换为垂直居中';
            s.alignToggleButton.setAttribute('title', alignTitle);
            s.alignToggleButton.setAttribute('aria-label', alignTitle);
        }
        if (s.autoFitToggleButton) {
            s.autoFitToggleButton.classList.toggle('is-active', this.autoFitEnabled);
            s.autoFitToggleButton.setAttribute('aria-pressed', String(this.autoFitEnabled));
            const autoFitTitle = this.autoFitEnabled ? '自动排版(点击关闭)' : '手动排版(点击开启自动)';
            s.autoFitToggleButton.setAttribute('title', autoFitTitle);
            s.autoFitToggleButton.setAttribute('aria-label', autoFitTitle);
        }
    }

    getLineHeightRatio(lineHeightValue, fontSizePx = this.baseFontSize || 16) {
        if (!lineHeightValue) return null;
        const numeric = parseFloat(lineHeightValue);
        if (!Number.isFinite(numeric)) return null;
        if (typeof lineHeightValue === 'string' && lineHeightValue.trim().endsWith('px')) {
            if (!Number.isFinite(fontSizePx) || fontSizePx === 0) return null;
            return numeric / fontSizePx;
        }
        return numeric;
    }
}
