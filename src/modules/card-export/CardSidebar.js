import { save, message } from '@tauri-apps/plugin-dialog';
import { captureScreenshot } from '../../api/native.js';
import { buildDefaultCardImagePath } from '../../utils/exportUtils.js';
import { CardSidebarResizeHandle } from './ResizeHandle.js';
import { addClickHandler } from '../../utils/PointerHelper.js';
import { CARD_TEMPLATES } from './cardTemplates.js';
import { CardSelectionController } from './CardSelectionController.js';
import { CardTextStyleController } from './CardTextStyleController.js';
import { renderCardToDataUrl } from './cardExportPipeline.js';

const PREVIEW_MAX_HEIGHT = 520;
const PREVIEW_FIXED_WIDTH = 340; // 固定预览宽度，不随 sidebar 变化
const FONT_SCALE_STEP = 0.1;
const LINE_HEIGHT_SCALE_STEP = 0.1;
const FONT_WEIGHT_STEP = 100;

const CARD_PRESETS = [
    { id: 'xiaohongshu', label: '小红书竖图', hint: '3:4', width: 960, height: 1280 },
    { id: 'wechat', label: '公众号竖图', hint: '2:3', width: 900, height: 1350 },
    { id: 'square', label: '方形配图', hint: '1:1', width: 900, height: 900 },
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
        this.autoFitToggleButton = null;
        this.cardBadgeElement = null;
        this.exportButton = null;
        this.statusElement = null;

        this.currentContent = '';
        this.currentContentHtml = '';
        this.selectedPresetId = CARD_PRESETS[0].id;
        this.selectedBackgroundId = CARD_TEMPLATES[0].id;
        this.backgroundSwatchElements = [];
        this.cardBackgroundElement = null;
        this.isExporting = false;
        this.previewRenderedWidth = null;
        this.previewRenderedHeight = null;
        this.themeObserver = null;

        this.unsubscribeLayout = null;
        this.clickCleanups = [];
        this.selectionController = new CardSelectionController(this);
        this.textStyle = new CardTextStyleController(this);
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
        this.textStyle.applyFontScale();
        this.textStyle.applyFontWeight();
        this.textStyle.applyVerticalAlign();
        this.textStyle.syncTextControlState();

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
            this.selectionController.capture(true);
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
        CARD_TEMPLATES.forEach((preset) => {
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
        if (!this.cardBackgroundElement || !this.cardElement) {
            return;
        }
        const template = CARD_TEMPLATES.find(p => p.id === this.selectedBackgroundId) || CARD_TEMPLATES[0];
        // 移除所有背景预设类
        CARD_TEMPLATES.forEach(p => {
            this.cardBackgroundElement.classList.remove(`card-preview-card__background--${p.id}`);
        });
        // 添加当前选中的背景类
        this.cardBackgroundElement.classList.add(`card-preview-card__background--${template.id}`);
        // 设置卡片主题（控制背景和阴影）
        this.cardElement.dataset.cardTheme = template.theme;
        // 设置内容区的 appearance，让 tiptap-editor 样式规则生效
        if (this.cardTextElement) {
            this.cardTextElement.dataset.themeAppearance = template.theme;
        }
        // 移除旧的装饰元素
        this.cardElement.querySelectorAll('.card-deco').forEach(el => el.remove());
        // 添加新的装饰元素
        if (template.buildDecorations) {
            const decorations = template.buildDecorations();
            decorations.forEach(deco => {
                const el = document.createElement('div');
                el.className = deco.class;
                el.textContent = deco.content;
                this.cardElement.appendChild(el);
            });
        }
    }

    buildTextControlsSection() {
        const section = document.createElement('section');
        section.className = 'card-sidebar__section card-sidebar__section--compact';

        const controls = document.createElement('div');
        controls.className = 'card-sidebar__text-controls';

        this.fontDecreaseButton = this.createTextControlButton({
            title: '缩小字体',
            onClick: () => this.textStyle.adjustFontScale(-FONT_SCALE_STEP),
            svg: `
                <path d="M4 11.5L7 4l3 7.5M5.2 9.3h3.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
            `,
        });

        this.fontIncreaseButton = this.createTextControlButton({
            title: '放大字体',
            onClick: () => this.textStyle.adjustFontScale(FONT_SCALE_STEP),
            svg: `
                <path d="M3.5 12.5L7.5 3l4 9.5M5.4 9.8h4.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
            `,
        });

        this.lineHeightDecreaseButton = this.createTextControlButton({
            title: '减小行距',
            onClick: () => this.textStyle.adjustLineHeightScale(-LINE_HEIGHT_SCALE_STEP),
            svg: `
                <path d="M4 5.5h8M4 10.5h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
                <path d="M6.5 7.8l1.5 1.4 1.5-1.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
            `,
        });

        this.lineHeightIncreaseButton = this.createTextControlButton({
            title: '增大行距',
            onClick: () => this.textStyle.adjustLineHeightScale(LINE_HEIGHT_SCALE_STEP),
            svg: `
                <path d="M4 4.5h8M4 11.5h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
                <path d="M6.5 6.5l1.5-1.4 1.5 1.4M6.5 9.5l1.5 1.4 1.5-1.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
            `,
        });

        this.fontWeightDecreaseButton = this.createTextControlButton({
            title: '降低字重',
            onClick: () => this.textStyle.adjustFontWeight(-FONT_WEIGHT_STEP),
            svg: `
                <path d="M4.5 4h4a2.5 2.5 0 1 1 0 5h-4V4z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
                <path d="M4.5 9h4.5a2.5 2.5 0 1 1 0 5H4.5V9z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
            `,
        });

        this.fontWeightIncreaseButton = this.createTextControlButton({
            title: '增加字重',
            onClick: () => this.textStyle.adjustFontWeight(FONT_WEIGHT_STEP),
            svg: `
                <path d="M4 4h4.2c1.8 0 3 0.9 3 2.4 0 1.4-1.2 2.4-3 2.4H4V4z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
                <path d="M4 8.8h4.4c1.8 0 3.1 0.9 3.1 2.4s-1.3 2.4-3.1 2.4H4V8.8z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
            `,
        });

        this.alignToggleButton = this.createTextControlButton({
            title: '切换垂直居中',
            onClick: () => this.textStyle.toggleVerticalAlign(),
            svg: `
                <path d="M4 5h10M4 13h10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                <path d="M6 8h6v4H6z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
            `,
        });

        this.autoFitToggleButton = this.createTextControlButton({
            title: '自动排版',
            onClick: () => this.textStyle.toggleAutoFit(),
            svg: `
                <path d="M3 6h12M3 12h12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                <path d="M7 3v3M11 3v3M7 12v3M11 12v3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
            `,
        });

        controls.appendChild(this.fontDecreaseButton);
        controls.appendChild(this.fontIncreaseButton);
        controls.appendChild(this.lineHeightDecreaseButton);
        controls.appendChild(this.lineHeightIncreaseButton);
        controls.appendChild(this.fontWeightDecreaseButton);
        controls.appendChild(this.fontWeightIncreaseButton);
        controls.appendChild(this.alignToggleButton);
        controls.appendChild(this.autoFitToggleButton);

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

        this.textStyle.applyVerticalAlign();
        return card;
    }

    onShow() {
        this.selectionController.capture(true);
        this.selectionController.start();
        window.addEventListener('resize', this.handleWindowResize);
        this.updatePreviewDimensions();
        this.textStyle.syncTextStylesFromMarkdown();
        if (!this.themeObserver) {
            this.themeObserver = new MutationObserver(() => {
                // 延迟执行，确保浏览器完成 CSS 样式重算
                requestAnimationFrame(() => this.textStyle.syncTextStylesFromMarkdown());
            });
        }
        this.themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme-appearance'],
        });
    }

    onHide() {
        this.selectionController.stop();
        window.removeEventListener('resize', this.handleWindowResize);
        this.themeObserver?.disconnect();
    }

    handleWindowResize() {
        this.updatePreviewDimensions();
    }

    updateContentPreview({ text = '', html = '', forceUpdate = false } = {}) {
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
        this.textStyle.syncTextStylesFromMarkdown();
        this.textStyle.applyFontScale();
        this.textStyle.applyFontWeight();
        this.textStyle.applyVerticalAlign();
        // 内容更新后自动调整字号和行距（仅在自动排版模式下）
        if (normalized && this.textStyle.autoFitEnabled) {
            this.textStyle.autoFitContent();
        }
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

            const dataUrl = await renderCardToDataUrl({
                cardElement: this.cardElement,
                cardTextElement: this.cardTextElement,
                previewInner: this.previewInner,
                width: preset.width,
                previewRenderedWidth: this.previewRenderedWidth,
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
        this.selectionController.stop();
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

}
