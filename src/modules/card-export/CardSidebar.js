import { save, message } from '@tauri-apps/plugin-dialog';
import { ensureToPng } from '../../app/coreModules.js';
import { captureScreenshot } from '../../api/native.js';
import { buildDefaultCardImagePath } from '../../utils/exportUtils.js';
import { CardSidebarResizeHandle } from './ResizeHandle.js';
import { addClickHandler } from '../../utils/PointerHelper.js';

const PREVIEW_MAX_HEIGHT = 520;
const PREVIEW_FIXED_WIDTH = 340; // 固定预览宽度，不随 sidebar 变化
const FONT_SCALE_MIN = 0.3;
const FONT_SCALE_MAX = 1.8;
const FONT_SCALE_STEP = 0.1;
const LINE_HEIGHT_SCALE_MIN = 0.8;
const LINE_HEIGHT_SCALE_MAX = 1.6;
const LINE_HEIGHT_SCALE_STEP = 0.1;
const FONT_WEIGHT_MIN = 300;
const FONT_WEIGHT_MAX = 800;
const FONT_WEIGHT_STEP = 100;
const EXPORT_FONT_SCALE = 1.02;

const CARD_PRESETS = [
    { id: 'xiaohongshu', label: '小红书竖图', hint: '3:4', width: 960, height: 1280 },
    { id: 'wechat', label: '公众号竖图', hint: '2:3', width: 900, height: 1350 },
    { id: 'square', label: '方形配图', hint: '1:1', width: 900, height: 900 },
];

// 背景预设 - 样式定义在 card-sidebar.css 中
// theme: 'dark' 表示深色背景用浅色文字，'light' 表示浅色背景用深色文字
const BACKGROUND_PRESETS = [
    { id: 'purple-blue', color: '#8b5cf6', theme: 'dark' },
    { id: 'frame', color: '#de7e7e', theme: 'light' },
    { id: 'green-teal', color: '#10b981', theme: 'dark' },
    { id: 'blue-cyan', color: '#3b82f6', theme: 'dark' },
    { id: 'rose-red', color: '#f43f5e', theme: 'dark' },
    { id: 'grid', color: '#8fa3b8', theme: 'light' },
    { id: 'slate-gray', color: '#64748b', theme: 'dark' },
    { id: 'neutral', color: '#e2e8f0', theme: 'light' },
];

export class CardSidebar {
    constructor({ layoutService }) {
        this.layoutService = layoutService;
        this.element = null;
        this.resizeHandle = null;
        this.selectionTextElement = null;
        this.selectionMetaElement = null;
        this.refreshButton = null;
        this.sizeSelectElement = null;
        this.previewContainer = null;
        this.previewInner = null;
        this.previewMetaElement = null;
        this.cardElement = null;
        this.cardBodyElement = null;
        this.cardTextElement = null;
        this.fontDecreaseButton = null;
        this.fontIncreaseButton = null;
        this.lineHeightDecreaseButton = null;
        this.lineHeightIncreaseButton = null;
        this.fontWeightDecreaseButton = null;
        this.fontWeightIncreaseButton = null;
        this.alignToggleButton = null;
        this.cardBadgeElement = null;
        this.exportButton = null;
        this.statusElement = null;

        this.currentContent = '';
        this.currentContentHtml = '';
        this.selectedPresetId = CARD_PRESETS[0].id;
        this.fontScale = 1;
        this.lineHeightScale = 1;
        this.baseFontSize = null;
        this.baseLineHeightRatio = null;
        this.fontWeight = 400;
        this.fontWeightModified = false;
        this.verticalAlign = 'top';
        this.selectedBackgroundId = BACKGROUND_PRESETS[0].id;
        this.backgroundSwatchElements = [];
        this.cardBackgroundElement = null;
        this.isExporting = false;
        this.selectionListenerActive = false;
        this.selectionChangeDebounce = null;
        this.previewRenderedWidth = null;
        this.previewRenderedHeight = null;
        this.themeObserver = null;

        this.unsubscribeLayout = null;
        this.clickCleanups = [];
        this.handleSelectionChange = this.handleSelectionChange.bind(this);
        this.handleWindowResize = this.handleWindowResize.bind(this);
    }

    render() {
        this.element = document.createElement('div');
        this.element.className = 'card-sidebar';

        this.resizeHandle = new CardSidebarResizeHandle({
            onResize: (value) => this.layoutService.setWidth(value),
        });
        this.element.appendChild(this.resizeHandle.render());

        this.element.appendChild(this.buildHeader());

        const body = document.createElement('div');
        body.className = 'card-sidebar__body';
        body.appendChild(this.buildSelectionSection());
        body.appendChild(this.buildSizeSection());
        body.appendChild(this.buildBackgroundSection());
        body.appendChild(this.buildTextControlsSection());
        body.appendChild(this.buildPreviewSection());
        this.element.appendChild(body);

        this.unsubscribeLayout = this.layoutService.subscribe(({ width, visible }) => {
            this.element.style.width = `${width}px`;
            if (visible) {
                this.onShow();
            } else {
                this.onHide();
            }
        });

        this.updateContentPreview();
        this.updatePresetUI();
        this.applyBackground();
        this.applyFontScale();
        this.applyFontWeight();
        this.applyVerticalAlign();
        this.syncTextControlState();

        return this.element;
    }

    buildHeader() {
        const header = document.createElement('div');
        header.className = 'card-sidebar__header';

        const titleWrap = document.createElement('div');
        titleWrap.className = 'card-sidebar__title-wrap';

        const title = document.createElement('div');
        title.className = 'card-sidebar__title';
        title.textContent = '内容卡片';

        titleWrap.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'card-sidebar__close-btn';
        closeBtn.setAttribute('title', '关闭');
        closeBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8"
                    stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            </svg>
        `;
        this.clickCleanups.push(addClickHandler(closeBtn, () => this.layoutService.hide()));

        header.appendChild(titleWrap);
        header.appendChild(closeBtn);
        return header;
    }

    buildSelectionSection() {
        const section = document.createElement('section');
        section.className = 'card-sidebar__section card-sidebar__section--collapsible is-collapsed';

        const header = document.createElement('div');
        header.className = 'card-sidebar__section-header';

        const label = document.createElement('div');
        label.className = 'card-sidebar__section-title';
        label.textContent = '选中内容';

        const toggle = document.createElement('span');
        toggle.className = 'card-sidebar__section-toggle';
        toggle.textContent = '▶';
        label.prepend(toggle);

        const selectionBox = document.createElement('div');
        selectionBox.className = 'card-sidebar__selection';

        this.selectionTextElement = document.createElement('div');
        this.selectionTextElement.className = 'card-sidebar__selection-text';
        selectionBox.appendChild(this.selectionTextElement);

        this.selectionMetaElement = document.createElement('div');
        this.selectionMetaElement.className = 'card-sidebar__selection-meta';
        selectionBox.appendChild(this.selectionMetaElement);

        this.refreshButton = document.createElement('button');
        this.refreshButton.type = 'button';
        this.refreshButton.className = 'card-sidebar__refresh-btn';
        this.refreshButton.textContent = '使用当前选中内容';
        this.clickCleanups.push(addClickHandler(this.refreshButton, () => {
            this.captureSelection(true);
        }));

        // 点击 header 展开/收起
        this.clickCleanups.push(addClickHandler(header, (e) => {
            if (e.target === this.refreshButton) return;
            section.classList.toggle('is-collapsed');
        }));

        header.appendChild(label);
        header.appendChild(this.refreshButton);

        section.appendChild(header);
        section.appendChild(selectionBox);
        return section;
    }

    buildSizeSection() {
        const section = document.createElement('section');
        section.className = 'card-sidebar__section';

        const label = document.createElement('div');
        label.className = 'card-sidebar__section-title';
        label.textContent = '卡片尺寸';
        section.appendChild(label);

        this.sizeSelectElement = document.createElement('select');
        this.sizeSelectElement.className = 'card-sidebar__size-select';
        CARD_PRESETS.forEach((preset) => {
            const option = document.createElement('option');
            option.value = preset.id;
            option.textContent = `${preset.label} · ${preset.width}×${preset.height} (${preset.hint})`;
            this.sizeSelectElement.appendChild(option);
        });
        this.sizeSelectElement.value = this.selectedPresetId;
        this.sizeSelectElement.addEventListener('change', () => {
            this.handlePresetChange(this.sizeSelectElement.value);
        });

        section.appendChild(this.sizeSelectElement);
        return section;
    }

    buildBackgroundSection() {
        const section = document.createElement('section');
        section.className = 'card-sidebar__section card-sidebar__section--compact';

        const label = document.createElement('div');
        label.className = 'card-sidebar__section-title';
        label.textContent = '背景样式';
        section.appendChild(label);

        const swatchContainer = document.createElement('div');
        swatchContainer.className = 'card-sidebar__bg-swatches';

        this.backgroundSwatchElements = [];
        BACKGROUND_PRESETS.forEach((preset) => {
            const swatch = document.createElement('button');
            swatch.type = 'button';
            swatch.className = 'card-sidebar__bg-swatch';
            swatch.style.backgroundColor = preset.color;
            swatch.setAttribute('title', preset.id);
            swatch.setAttribute('data-bg-id', preset.id);
            if (preset.id === this.selectedBackgroundId) {
                swatch.classList.add('is-active');
            }
            this.clickCleanups.push(addClickHandler(swatch, () => this.handleBackgroundChange(preset.id)));
            swatchContainer.appendChild(swatch);
            this.backgroundSwatchElements.push(swatch);
        });

        section.appendChild(swatchContainer);
        return section;
    }

    handleBackgroundChange(bgId) {
        if (bgId === this.selectedBackgroundId) {
            return;
        }
        this.selectedBackgroundId = bgId;
        this.updateBackgroundUI();
        this.applyBackground();
    }

    updateBackgroundUI() {
        this.backgroundSwatchElements.forEach((swatch) => {
            const id = swatch.getAttribute('data-bg-id');
            swatch.classList.toggle('is-active', id === this.selectedBackgroundId);
        });
    }

    applyBackground() {
        if (!this.cardBackgroundElement) {
            return;
        }
        const preset = BACKGROUND_PRESETS.find(p => p.id === this.selectedBackgroundId) || BACKGROUND_PRESETS[0];
        // 移除所有背景预设类
        BACKGROUND_PRESETS.forEach(p => {
            this.cardBackgroundElement.classList.remove(`card-preview-card__background--${p.id}`);
        });
        // 添加当前选中的背景类
        this.cardBackgroundElement.classList.add(`card-preview-card__background--${preset.id}`);
        // 设置卡片主题（控制文字颜色，不随应用主题变化）
        if (this.cardElement) {
            this.cardElement.dataset.cardTheme = preset.theme;
        }
    }

    buildTextControlsSection() {
        const section = document.createElement('section');
        section.className = 'card-sidebar__section card-sidebar__section--compact';

        const controls = document.createElement('div');
        controls.className = 'card-sidebar__text-controls';

        this.fontDecreaseButton = this.createTextControlButton({
            title: '缩小字体',
            onClick: () => this.adjustFontScale(-FONT_SCALE_STEP),
            svg: `
                <path d="M4 11.5L7 4l3 7.5M5.2 9.3h3.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
            `,
        });

        this.fontIncreaseButton = this.createTextControlButton({
            title: '放大字体',
            onClick: () => this.adjustFontScale(FONT_SCALE_STEP),
            svg: `
                <path d="M3.5 12.5L7.5 3l4 9.5M5.4 9.8h4.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
            `,
        });

        this.lineHeightDecreaseButton = this.createTextControlButton({
            title: '减小行距',
            onClick: () => this.adjustLineHeightScale(-LINE_HEIGHT_SCALE_STEP),
            svg: `
                <path d="M4 5.5h8M4 10.5h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
                <path d="M6.5 7.8l1.5 1.4 1.5-1.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
            `,
        });

        this.lineHeightIncreaseButton = this.createTextControlButton({
            title: '增大行距',
            onClick: () => this.adjustLineHeightScale(LINE_HEIGHT_SCALE_STEP),
            svg: `
                <path d="M4 4.5h8M4 11.5h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
                <path d="M6.5 6.5l1.5-1.4 1.5 1.4M6.5 9.5l1.5 1.4 1.5-1.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
            `,
        });

        this.fontWeightDecreaseButton = this.createTextControlButton({
            title: '降低字重',
            onClick: () => this.adjustFontWeight(-FONT_WEIGHT_STEP),
            svg: `
                <path d="M4.5 4h4a2.5 2.5 0 1 1 0 5h-4V4z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
                <path d="M4.5 9h4.5a2.5 2.5 0 1 1 0 5H4.5V9z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
            `,
        });

        this.fontWeightIncreaseButton = this.createTextControlButton({
            title: '增加字重',
            onClick: () => this.adjustFontWeight(FONT_WEIGHT_STEP),
            svg: `
                <path d="M4 4h4.2c1.8 0 3 0.9 3 2.4 0 1.4-1.2 2.4-3 2.4H4V4z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
                <path d="M4 8.8h4.4c1.8 0 3.1 0.9 3.1 2.4s-1.3 2.4-3.1 2.4H4V8.8z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
            `,
        });

        this.alignToggleButton = this.createTextControlButton({
            title: '切换垂直居中',
            onClick: () => this.toggleVerticalAlign(),
            svg: `
                <path d="M4 5h10M4 13h10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                <path d="M6 8h6v4H6z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
            `,
        });

        controls.appendChild(this.fontDecreaseButton);
        controls.appendChild(this.fontIncreaseButton);
        controls.appendChild(this.lineHeightDecreaseButton);
        controls.appendChild(this.lineHeightIncreaseButton);
        controls.appendChild(this.fontWeightDecreaseButton);
        controls.appendChild(this.fontWeightIncreaseButton);
        controls.appendChild(this.alignToggleButton);

        section.appendChild(controls);
        return section;
    }

    buildPreviewSection() {
        const section = document.createElement('section');
        section.className = 'card-sidebar__section card-sidebar__section--preview';

        const label = document.createElement('div');
        label.className = 'card-sidebar__section-title';
        label.textContent = '预览与导出';
        section.appendChild(label);

        this.previewContainer = document.createElement('div');
        this.previewContainer.className = 'card-sidebar__preview';

        this.previewInner = document.createElement('div');
        this.previewInner.className = 'card-sidebar__preview-inner';
        this.previewContainer.appendChild(this.previewInner);

        this.cardElement = this.buildCardElement();
        this.previewInner.appendChild(this.cardElement);

        section.appendChild(this.previewContainer);

        this.previewMetaElement = document.createElement('div');
        this.previewMetaElement.className = 'card-sidebar__preview-meta';
        section.appendChild(this.previewMetaElement);

        const actions = document.createElement('div');
        actions.className = 'card-sidebar__actions';

        this.exportButton = document.createElement('button');
        this.exportButton.type = 'button';
        this.exportButton.className = 'card-sidebar__export-btn';
        this.exportButton.textContent = '导出 PNG';
        this.clickCleanups.push(addClickHandler(this.exportButton, () => this.handleExport()));
        actions.appendChild(this.exportButton);

        this.statusElement = document.createElement('div');
        this.statusElement.className = 'card-sidebar__status';
        actions.appendChild(this.statusElement);

        section.appendChild(actions);
        return section;
    }

    buildCardElement() {
        const card = document.createElement('div');
        card.className = 'card-preview-card';

        const gradient = document.createElement('div');
        gradient.className = 'card-preview-card__background';
        this.cardBackgroundElement = gradient;
        card.appendChild(gradient);

        const body = document.createElement('div');
        body.className = 'card-preview-card__body';
        this.cardBodyElement = body;

        this.cardTextElement = document.createElement('div');
        this.cardTextElement.className = 'card-preview-card__content tiptap-editor';

        const footer = document.createElement('div');
        footer.className = 'card-preview-card__footer';
        footer.textContent = "- MARK2 -";

       body.appendChild(this.cardTextElement);
       card.appendChild(body);
       card.appendChild(footer);

        this.applyVerticalAlign();
        return card;
    }

    onShow() {
        this.captureSelection(true);
        this.startSelectionTracking();
        window.addEventListener('resize', this.handleWindowResize);
        this.updatePreviewDimensions();
        this.syncTextStylesFromMarkdown();
        if (!this.themeObserver) {
            this.themeObserver = new MutationObserver(() => {
                // 延迟执行，确保浏览器完成 CSS 样式重算
                requestAnimationFrame(() => this.syncTextStylesFromMarkdown());
            });
        }
        this.themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme-appearance'],
        });
    }

    onHide() {
        this.stopSelectionTracking();
        window.removeEventListener('resize', this.handleWindowResize);
        this.themeObserver?.disconnect();
    }

    handleWindowResize() {
        this.updatePreviewDimensions();
    }

    startSelectionTracking() {
        if (this.selectionListenerActive) {
            return;
        }
        this.selectionListenerActive = true;
        document.addEventListener('selectionchange', this.handleSelectionChange);
    }

    stopSelectionTracking() {
        if (!this.selectionListenerActive) {
            return;
        }
        this.selectionListenerActive = false;
        document.removeEventListener('selectionchange', this.handleSelectionChange);
        if (this.selectionChangeDebounce) {
            clearTimeout(this.selectionChangeDebounce);
            this.selectionChangeDebounce = null;
        }
    }

    handleSelectionChange() {
        if (this.selectionChangeDebounce) {
            clearTimeout(this.selectionChangeDebounce);
        }
        this.selectionChangeDebounce = setTimeout(() => this.captureSelection(false), 300);
    }

    captureSelection(forceUpdate = false) {
        const payload = this.getCurrentSelectionPayload();
        if (!payload.inMarkdown) {
            return;
        }
        if (!payload.text && !payload.html && !forceUpdate) {
            return;
        }
        this.updateContentPreview(payload);
    }

    getCurrentSelectionPayload() {
        try {
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0) {
                return { text: '', html: '', inMarkdown: false };
            }

            const text = selection.toString().trim();
            const range = selection.getRangeAt(0);
            const markdownRoot =
                document.querySelector('.markdown-pane .markdown-content') ||
                document.querySelector('.markdown-content');

            if (!markdownRoot || !range || !markdownRoot.contains(range.commonAncestorContainer)) {
                return { text: '', html: '', inMarkdown: false };
            }

            const fragment = range.cloneContents();
            const container = document.createElement('div');
            container.appendChild(fragment);
            this.sanitizeSelectionHtml(container);

            const html = container.innerHTML.trim();
            return {
                text,
                html,
                inMarkdown: true,
            };
        } catch (error) {
            console.warn('[CardSidebar] 无法读取选中文本', error);
            return { text: '', html: '', inMarkdown: false };
        }
    }

    sanitizeSelectionHtml(container) {
        if (!container) {
            return;
        }

        container.querySelectorAll('script, style').forEach(node => node.remove());
        container.querySelectorAll('*').forEach(node => {
            [...node.attributes].forEach(attr => {
                const name = attr.name.toLowerCase();
                if (name.startsWith('on') || name === 'contenteditable') {
                    node.removeAttribute(attr.name);
                }
            });
            // 移除背景相关的内联样式，使用卡片自身的背景色
            if (node.style) {
                node.style.removeProperty('background');
                node.style.removeProperty('background-color');
                node.style.removeProperty('background-image');
            }
        });

        // 检测孤立的 li 元素（没有 ul/ol 父级），用 ul 包裹
        const orphanLis = [...container.children].filter(
            child => child.tagName === 'LI'
        );
        if (orphanLis.length > 0) {
            const ul = document.createElement('ul');
            orphanLis.forEach(li => ul.appendChild(li));
            container.appendChild(ul);
        }
    }

    updateContentPreview({ text = '', html = '' } = {}) {
        const normalized = text?.trim() || '';
        const normalizedHtml = html?.trim() || '';
        this.currentContent = normalized;
        this.currentContentHtml = normalizedHtml;

        if (normalized) {
            this.selectionTextElement.textContent = normalized;
            this.selectionTextElement.classList.remove('is-empty');
            this.selectionMetaElement.textContent = `${normalized.length} 字符`;
            if (normalizedHtml) {
                this.cardTextElement.innerHTML = normalizedHtml;
            } else {
                this.cardTextElement.textContent = normalized;
            }
            this.cardElement.classList.remove('is-empty');
        } else {
            this.selectionTextElement.textContent = '未检测到选中内容，请先在正文中选择文本。';
            this.selectionTextElement.classList.add('is-empty');
            this.selectionMetaElement.textContent = '';
            this.cardTextElement.textContent = '请在文档中选中文本，我们会自动填充到卡片中。';
            this.cardElement.classList.add('is-empty');
            this.currentContentHtml = '';
        }
        this.syncTextStylesFromMarkdown();
        this.applyFontScale();
        this.applyFontWeight();
        this.applyVerticalAlign();
        // 内容更新后自动调整字号和行距
        if (normalized) {
            this.autoFitContent();
        }
    }

    /**
     * 自动调整字号和行距，确保内容完全显示不溢出
     */
    autoFitContent() {
        if (!this.cardTextElement || !this.currentContent) {
            return;
        }

        // 重置到默认缩放值
        this.fontScale = 1;
        this.lineHeightScale = 1;
        this.applyFontScale();
        // 移除自动调整标记
        this.cardElement.classList.remove('card-preview-card--auto-fit');

        // 等待 DOM 更新后检测溢出
        requestAnimationFrame(() => {
            this._adjustToFit();
        });
    }

    /**
     * 递减调整字号和行距直到内容不溢出
     */
    _adjustToFit() {
        const isOverflowing = () => {
            // 检测内容是否超出可视区域
            return this.cardTextElement.scrollHeight > this.cardTextElement.clientHeight + 2;
        };

        // 如果没有溢出，不需要调整
        if (!isOverflowing()) {
            this.syncTextControlState();
            return;
        }

        // 触发了自动调整，增加上下 padding 留出水印位置
        this.cardElement.classList.add('card-preview-card--auto-fit');

        const STEP = 0.05;
        let iterations = 0;
        const MAX_ITERATIONS = 50;

        while (isOverflowing() && iterations < MAX_ITERATIONS) {
            iterations++;

            // 先缩小字体
            if (this.fontScale > FONT_SCALE_MIN + STEP) {
                this.fontScale = Math.max(FONT_SCALE_MIN, this.fontScale - STEP);
                this.applyFontScale();
                continue;
            }

            // 字体到最小后，缩小行高
            if (this.lineHeightScale > LINE_HEIGHT_SCALE_MIN + STEP) {
                this.lineHeightScale = Math.max(LINE_HEIGHT_SCALE_MIN, this.lineHeightScale - STEP);
                this.applyLineHeightScale();
                continue;
            }

            // 都到最小值了，退出
            break;
        }

        this.syncTextControlState();
    }

    handlePresetChange(presetId) {
        if (presetId === this.selectedPresetId) {
            return;
        }
        this.selectedPresetId = presetId;
        this.updatePresetUI();
    }

    updatePresetUI() {
        const preset = this.getActivePreset();
        if (!preset) {
            return;
        }

        if (this.sizeSelectElement) {
            this.sizeSelectElement.value = preset.id;
        }

        this.previewMetaElement.textContent = `${preset.label} · ${preset.width} × ${preset.height} (${preset.hint})`;
        this.applyPreviewScale(preset);
    }

    updatePreviewDimensions() {
        const preset = this.getActivePreset();
        if (!preset) {
            return;
        }
        this.applyPreviewScale(preset);
    }

    applyPreviewScale(preset) {
        if (!this.previewInner || !this.cardElement) {
            return;
        }

        // 使用固定宽度，不随 sidebar 变化
        const availableWidth = Math.max(PREVIEW_FIXED_WIDTH - 20, 200);
        let displayWidth = Math.min(availableWidth, preset.width);
        let displayHeight = Math.round((displayWidth / preset.width) * preset.height);

        if (displayHeight > PREVIEW_MAX_HEIGHT) {
            displayHeight = PREVIEW_MAX_HEIGHT;
            displayWidth = Math.round((displayHeight / preset.height) * preset.width);
        }

        this.previewRenderedWidth = displayWidth;
        this.previewRenderedHeight = displayHeight;

        this.previewInner.style.width = `${displayWidth}px`;
        this.previewInner.style.height = `${displayHeight}px`;

        this.cardElement.style.width = `${displayWidth}px`;
        this.cardElement.style.height = `${displayHeight}px`;
        this.cardElement.style.transform = '';
    }

    syncTextStylesFromMarkdown() {
        if (!this.cardTextElement) {
            return;
        }
        try {
            const markdownContent =
                document.querySelector('.markdown-pane .tiptap-editor') ||
                document.querySelector('.tiptap-editor') ||
                document.querySelector('.markdown-pane .markdown-content') ||
                document.querySelector('.markdown-content');
            if (!markdownContent) {
                return;
            }
            const styles = window.getComputedStyle(markdownContent);
            if (!this.fontWeightModified) {
                const parsedWeight = parseInt(styles.fontWeight, 10);
                if (Number.isFinite(parsedWeight)) {
                    this.fontWeight = Math.min(FONT_WEIGHT_MAX, Math.max(FONT_WEIGHT_MIN, parsedWeight));
                } else if (!Number.isFinite(this.fontWeight)) {
                    this.fontWeight = 400;
                }
            }
            this.cardTextElement.style.fontFamily = styles.fontFamily;
            this.applyFontWeight();
            this.cardTextElement.style.letterSpacing = styles.letterSpacing;
            // 不同步 color，由 CSS 的 data-card-theme 控制
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
            console.warn('[CardSidebar] 无法同步 Markdown 样式', error);
        }
    }

    getActivePreset() {
        return CARD_PRESETS.find(item => item.id === this.selectedPresetId) || CARD_PRESETS[0];
    }

    async handleExport() {
        if (this.isExporting) {
            return;
        }

        const content = this.currentContent.trim();
        if (!content) {
            this.showStatus('请先在文档中选中需要导出的内容。', 'error');
            return;
        }

        const preset = this.getActivePreset();
        this.setExporting(true);
        this.showStatus('正在生成图片…', 'info');

        try {
            const defaultPath = await buildDefaultCardImagePath(preset.label);
            const targetPath = await save({
                title: '导出卡片 PNG',
                filters: [{ name: 'PNG 图片', extensions: ['png'] }],
                defaultPath,
            });
            if (!targetPath) {
                this.showStatus('已取消导出', 'info');
                return;
            }

            const dataUrl = await this.renderCardToDataUrl({
                width: preset.width,
            });
            await captureScreenshot(targetPath, dataUrl);
            this.showStatus(`已保存：${targetPath}`, 'success', { persist: true });
        } catch (error) {
            console.error('[CardSidebar] 导出失败', error);
            this.showStatus('导出失败，请查看日志。', 'error');
            await message(`导出卡片失败：${error?.message || error}`, {
                title: '导出失败',
                kind: 'error',
            });
        } finally {
            this.setExporting(false);
        }
    }

    async renderCardToDataUrl({ width }) {
        if (!this.cardElement) {
            throw new Error('无法找到卡片预览元素');
        }

        const previewWidth = this.previewRenderedWidth || this.cardElement.clientWidth || width;
        // 直接以预览 DOM 排版，导出时只放大像素密度，保证折行一致
        const scale = width / previewWidth;

        const contentNode = this.cardTextElement;
        const originalInline = contentNode
            ? {
                fontSize: contentNode.style.fontSize,
                lineHeight: contentNode.style.lineHeight,
                letterSpacing: contentNode.style.letterSpacing,
            }
            : null;

        // 保存背景元素原始内联样式
        const bgElement = this.cardElement.querySelector('.card-preview-card__background');
        const originalBgInline = bgElement
            ? {
                background: bgElement.style.background,
                boxShadow: bgElement.style.boxShadow,
                opacity: bgElement.style.opacity,
                border: bgElement.style.border,
                boxSizing: bgElement.style.boxSizing,
            }
            : null;

        // 保存图片原始 src，用于导出后恢复
        const imgSrcBackup = new Map();

        try {
            // 闪光效果遮盖样式变化（放在父容器上，避免被导出）
            this.previewInner.classList.add('is-capturing');

            // 预处理图片：移除无效图片，转换 blob URL 为 data URL
            await this.prepareImagesForExport(imgSrcBackup);

            if (contentNode && EXPORT_FONT_SCALE !== 1) {
                const computed = window.getComputedStyle(contentNode);
                const baseFontSize = parseFloat(computed.fontSize) || 16;
                const parsedLineHeight = parseFloat(computed.lineHeight);
                const baseLineHeight = Number.isFinite(parsedLineHeight)
                    ? parsedLineHeight
                    : baseFontSize * 1.6;
                const parsedLetterSpacing = parseFloat(computed.letterSpacing);
                const baseLetterSpacing = Number.isFinite(parsedLetterSpacing) ? parsedLetterSpacing : 0;

                contentNode.style.fontSize = `${baseFontSize * EXPORT_FONT_SCALE}px`;
                contentNode.style.lineHeight = `${baseLineHeight * EXPORT_FONT_SCALE}px`;
                contentNode.style.letterSpacing = `${baseLetterSpacing * EXPORT_FONT_SCALE}px`;
            }

            // 把背景样式转为内联样式（导出需要）
            this.embedInlineStyles(this.cardElement);

            await document.fonts?.ready;

            const toPng = await ensureToPng();
            return await toPng(this.cardElement, {
                backgroundColor: '#ffffff',
                pixelRatio: scale,
                cacheBust: true,
            });
        } finally {
            if (contentNode && originalInline) {
                contentNode.style.fontSize = originalInline.fontSize;
                contentNode.style.lineHeight = originalInline.lineHeight;
                contentNode.style.letterSpacing = originalInline.letterSpacing;
            }
            // 恢复背景元素原始内联样式
            if (bgElement && originalBgInline) {
                bgElement.style.background = originalBgInline.background;
                bgElement.style.boxShadow = originalBgInline.boxShadow;
                bgElement.style.opacity = originalBgInline.opacity;
                bgElement.style.border = originalBgInline.border;
                bgElement.style.boxSizing = originalBgInline.boxSizing;
            }
            // 恢复图片状态
            for (const [img, backup] of imgSrcBackup) {
                if (backup.type === 'removed') {
                    // 恢复被移除的图片
                    backup.parent?.insertBefore(img, backup.nextSibling);
                } else if (backup.type === 'src') {
                    // 恢复原始 src
                    img.src = backup.value;
                }
            }
            // 闪光恢复动画
            this.previewInner.classList.remove('is-capturing');
            this.previewInner.classList.add('is-capture-done');
            setTimeout(() => {
                this.previewInner.classList.remove('is-capture-done');
            }, 500);
        }
    }

    /**
     * 预处理图片以便导出：
     * 1. 移除无效图片（空 src 或 ProseMirror 占位符）
     * 2. 将 blob URL 转换为 data URL
     */
    async prepareImagesForExport(backupMap) {
        const imgs = [...this.cardElement.querySelectorAll('img')];
        const promises = [];

        for (const img of imgs) {
            // 移除空 src 或 ProseMirror 占位符图片
            if (!img.src || img.classList.contains('ProseMirror-separator')) {
                backupMap.set(img, { type: 'removed', parent: img.parentNode, nextSibling: img.nextSibling });
                img.remove();
                continue;
            }

            // 转换 blob URL 为 data URL
            if (img.src.startsWith('blob:')) {
                backupMap.set(img, { type: 'src', value: img.src });

                const promise = fetch(img.src)
                    .then(res => res.blob())
                    .then(blob => {
                        return new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => {
                                img.src = reader.result;
                                resolve();
                            };
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        });
                    })
                    .catch(err => {
                        console.warn('[CardSidebar] blob 转 dataUrl 失败:', img.src, err);
                    });
                promises.push(promise);
            }
        }

        await Promise.all(promises);
    }

    embedInlineStyles(cardNode) {
        if (!cardNode) {
            return;
        }
        // 把背景的 CSS 类样式转换为内联样式（导出需要）
        const bgElement = cardNode.querySelector('.card-preview-card__background');
        if (bgElement) {
            const computed = window.getComputedStyle(bgElement);
            bgElement.style.background = computed.background;
            bgElement.style.opacity = computed.opacity;
            // html-to-image 不支持 inset box-shadow，frame 样式用 border 代替
            if (bgElement.classList.contains('card-preview-card__background--frame')) {
                bgElement.style.border = '10px solid #de7e7e';
                bgElement.style.boxSizing = 'border-box';
            } else {
                bgElement.style.boxShadow = computed.boxShadow;
            }
        }
    }

    setExporting(state) {
        this.isExporting = state;
        if (this.exportButton) {
            this.exportButton.disabled = state;
            this.exportButton.textContent = state ? '导出中…' : '导出 PNG';
        }
    }

    showStatus(text, state = 'info', options = {}) {
        if (!this.statusElement) {
            return;
        }
        this.statusElement.textContent = text || '';
        this.statusElement.dataset.state = state;
        if (!options.persist) {
            setTimeout(() => {
                this.statusElement.textContent = '';
                delete this.statusElement.dataset.state;
            }, 3600);
        }
    }

    show() {
        this.layoutService.show();
    }

    hide() {
        this.layoutService.hide();
    }

    toggle() {
        this.layoutService.toggle();
    }

    destroy() {
        this.stopSelectionTracking();
        window.removeEventListener('resize', this.handleWindowResize);
        if (this.unsubscribeLayout) {
            this.unsubscribeLayout();
            this.unsubscribeLayout = null;
        }
        this.clickCleanups.forEach(cleanup => cleanup?.());
        this.clickCleanups = [];
        this.resizeHandle?.destroy();
        this.element = null;
    }

    adjustFontScale(delta) {
        this.setFontScale(this.fontScale + delta);
    }

    setFontScale(value) {
        const next = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Number(value) || 1));
        const changed = Math.abs(next - this.fontScale) > 0.001;
        this.fontScale = next;
        if (changed) {
            this.applyFontScale();
        } else {
            this.applyLineHeightScale();
        }
        this.syncTextControlState();
    }

    applyFontScale() {
        if (!this.cardTextElement) {
            return;
        }
        let baseSize = this.baseFontSize;
        if (!Number.isFinite(baseSize)) {
            const computed = window.getComputedStyle(this.cardTextElement);
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
        this.cardTextElement.style.fontSize = `${scaled}px`;
        this.applyLineHeightScale();
    }

    adjustLineHeightScale(delta) {
        this.setLineHeightScale(this.lineHeightScale + delta);
    }

    setLineHeightScale(value) {
        const next = Math.min(LINE_HEIGHT_SCALE_MAX, Math.max(LINE_HEIGHT_SCALE_MIN, Number(value) || 1));
        const changed = Math.abs(next - this.lineHeightScale) > 0.001;
        this.lineHeightScale = next;
        if (changed) {
            this.applyLineHeightScale();
        }
        this.syncTextControlState();
    }

    applyLineHeightScale() {
        if (!this.cardTextElement) {
            return;
        }
        const baseFont = this.baseFontSize || (parseFloat(window.getComputedStyle(this.cardTextElement).fontSize) / this.fontScale) || 16;
        const ratio = this.baseLineHeightRatio ?? 1.6;
        const px = baseFont * this.fontScale * ratio * this.lineHeightScale;
        this.cardTextElement.style.lineHeight = `${px}px`;
    }

    syncTextControlState() {
        if (this.fontDecreaseButton) {
            this.fontDecreaseButton.disabled = this.fontScale <= FONT_SCALE_MIN + 0.001;
        }
        if (this.fontIncreaseButton) {
            this.fontIncreaseButton.disabled = this.fontScale >= FONT_SCALE_MAX - 0.001;
        }
        if (this.lineHeightDecreaseButton) {
            this.lineHeightDecreaseButton.disabled = this.lineHeightScale <= LINE_HEIGHT_SCALE_MIN + 0.001;
        }
        if (this.lineHeightIncreaseButton) {
            this.lineHeightIncreaseButton.disabled = this.lineHeightScale >= LINE_HEIGHT_SCALE_MAX - 0.001;
        }
        if (this.fontWeightDecreaseButton) {
            this.fontWeightDecreaseButton.disabled = this.fontWeight <= FONT_WEIGHT_MIN;
        }
        if (this.fontWeightIncreaseButton) {
            this.fontWeightIncreaseButton.disabled = this.fontWeight >= FONT_WEIGHT_MAX;
        }
        if (this.alignToggleButton) {
            const isCenter = this.verticalAlign === 'center';
            this.alignToggleButton.classList.toggle('is-active', isCenter);
            this.alignToggleButton.setAttribute('aria-pressed', String(isCenter));
            this.alignToggleButton.setAttribute('title', isCenter ? '切换为顶部对齐' : '切换为垂直居中');
            this.alignToggleButton.setAttribute('aria-label', isCenter ? '切换为顶部对齐' : '切换为垂直居中');
        }
    }

    adjustFontWeight(delta) {
        this.setFontWeight((this.fontWeight || 400) + delta);
    }

    setFontWeight(value) {
        if (!Number.isFinite(value)) {
            return;
        }
        const rounded = Math.round(value / FONT_WEIGHT_STEP) * FONT_WEIGHT_STEP;
        const next = Math.min(FONT_WEIGHT_MAX, Math.max(FONT_WEIGHT_MIN, rounded));
        if (next === this.fontWeight) {
            return;
        }
        this.fontWeight = next;
        this.fontWeightModified = true;
        this.applyFontWeight();
        this.syncTextControlState();
    }

    applyFontWeight() {
        if (!this.cardTextElement) {
            return;
        }
        const weight = Number.isFinite(this.fontWeight) ? this.fontWeight : 400;
        this.cardTextElement.style.fontWeight = `${weight}`;
    }

    toggleVerticalAlign() {
        this.setVerticalAlign(this.verticalAlign === 'center' ? 'top' : 'center');
    }

    setVerticalAlign(mode) {
        const next = mode === 'center' ? 'center' : 'top';
        if (next === this.verticalAlign) {
            return;
        }
        this.verticalAlign = next;
        this.applyVerticalAlign();
        this.syncTextControlState();
    }

    applyVerticalAlign() {
        if (!this.cardElement) {
            return;
        }
        if (this.verticalAlign === 'center') {
            this.cardElement.classList.add('card-preview-card--align-center');
        } else {
            this.cardElement.classList.remove('card-preview-card--align-center');
        }
    }

    createTextControlButton({ title, onClick, svg }) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'card-sidebar__text-btn';
        if (title) {
            button.setAttribute('title', title);
            button.setAttribute('aria-label', title);
        }
        button.innerHTML = `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">${svg}</svg>`;
        this.clickCleanups.push(addClickHandler(button, onClick));
        return button;
    }

    getLineHeightRatio(lineHeightValue, fontSizePx = this.baseFontSize || 16) {
        if (!lineHeightValue) {
            return null;
        }
        const numeric = parseFloat(lineHeightValue);
        if (!Number.isFinite(numeric)) {
            return null;
        }
        if (typeof lineHeightValue === 'string' && lineHeightValue.trim().endsWith('px')) {
            if (!Number.isFinite(fontSizePx) || fontSizePx === 0) {
                return null;
            }
            return numeric / fontSizePx;
        }
        return numeric;
    }
}
