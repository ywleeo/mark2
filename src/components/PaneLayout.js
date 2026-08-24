import { addClickHandler } from '../utils/PointerHelper.js';
import { basename } from '../utils/pathUtils.js';
import { DEFAULT_SPLIT_RATIO, PANE_IDS, PANE_LAYOUT_MODES } from '../core/layout/PaneManager.js';

/**
 * 固定左右双栏的 DOM 布局控制器。
 * 该组件只投影 PaneManager 状态并采集焦点、关闭和拖动意图，不负责加载或保存文档。
 */
export class PaneLayout {
    /**
     * @param {Object} options - 布局依赖。
     * @param {Object} options.paneManager - Pane 状态管理器。
     * @param {Function} [options.onCloseSecondary] - 请求关闭副栏。
     * @param {Function} [options.onPromoteSecondary] - 请求在主栏打开副栏文档。
     * @param {Function} [options.onSplitRatioCommit] - 完成拖动后的持久化回调。
     */
    constructor({
        paneManager,
        onCloseSecondary,
        onPromoteSecondary,
        onSplitRatioCommit,
    }) {
        if (!paneManager) {
            throw new Error('PaneLayout 需要 paneManager');
        }
        this.paneManager = paneManager;
        this.onCloseSecondary = onCloseSecondary;
        this.onPromoteSecondary = onPromoteSecondary;
        this.onSplitRatioCommit = onSplitRatioCommit;
        this.cleanups = [];
        this.elements = null;
        this.resizeState = null;
    }

    /**
     * 绑定现有应用 DOM 并开始投影布局状态。
     * @returns {PaneLayout} 当前实例。
     */
    mount() {
        this.elements = {
            contentArea: document.getElementById('contentArea'),
            headerRow: document.getElementById('paneHeaderRow'),
            primaryPane: document.getElementById('primaryPane'),
            secondaryPane: document.getElementById('secondaryPane'),
            secondaryHeader: document.getElementById('secondaryPaneHeader'),
            secondaryTitle: document.querySelector('.secondary-pane-title'),
            secondaryTitleName: document.querySelector('.secondary-pane-title__name'),
            secondaryDirty: document.querySelector('.secondary-pane-title__dirty'),
            resizer: document.getElementById('paneResizer'),
            closeButton: document.getElementById('secondaryPaneClose'),
            promoteButton: document.getElementById('secondaryPanePromote'),
        };

        const requiredElements = [
            this.elements.contentArea,
            this.elements.headerRow,
            this.elements.primaryPane,
            this.elements.secondaryPane,
            this.elements.secondaryHeader,
            this.elements.secondaryTitleName,
            this.elements.resizer,
            this.elements.closeButton,
        ];
        if (requiredElements.some(element => !element)) {
            throw new Error('PaneLayout 缺少必要的左右栏 DOM');
        }

        this.cleanups.push(this.paneManager.subscribe(event => this.render(event.snapshot)));
        this.cleanups.push(addClickHandler(this.elements.closeButton, () => {
            this.onCloseSecondary?.();
        }));
        if (this.elements.promoteButton) {
            this.cleanups.push(addClickHandler(this.elements.promoteButton, () => {
                this.onPromoteSecondary?.();
            }));
        }

        this.bindPaneFocus(this.elements.primaryPane, PANE_IDS.PRIMARY);
        this.bindPaneFocus(this.elements.secondaryPane, PANE_IDS.SECONDARY);
        this.bindResize();
        this.render(this.paneManager.getSnapshot());
        return this;
    }

    /**
     * 将一次 Pane 点击或编辑器聚焦映射为活动栏。
     * @param {HTMLElement} element - Pane 根元素。
     * @param {'primary'|'secondary'} paneId - Pane 标识。
     */
    bindPaneFocus(element, paneId) {
        const focusPane = () => this.paneManager.focusPane(paneId);
        element.addEventListener('pointerdown', focusPane);
        element.addEventListener('focusin', focusPane);
        this.cleanups.push(() => {
            element.removeEventListener('pointerdown', focusPane);
            element.removeEventListener('focusin', focusPane);
        });
    }

    /**
     * 绑定横向比例拖动；拖动过程中只更新内存，结束后再请求持久化。
     */
    bindResize() {
        const { resizer, contentArea } = this.elements;

        /** 开始一次分栏拖动。 */
        const onPointerDown = event => {
            if (this.paneManager.getMode() !== PANE_LAYOUT_MODES.DUAL || event.button !== 0) {
                return;
            }
            event.preventDefault();
            const bounds = contentArea.getBoundingClientRect();
            if (!bounds.width) {
                return;
            }
            this.resizeState = { left: bounds.left, width: bounds.width };
            document.body.classList.add('is-pane-resizing');
            resizer.setPointerCapture?.(event.pointerId);
        };

        /** 根据指针位置更新主栏宽度比例。 */
        const onPointerMove = event => {
            if (!this.resizeState) {
                return;
            }
            const ratio = (event.clientX - this.resizeState.left) / this.resizeState.width;
            this.paneManager.setSplitRatio(ratio);
        };

        /** 提交一次分栏拖动。 */
        const onPointerUp = () => {
            if (!this.resizeState) {
                return;
            }
            this.resizeState = null;
            document.body.classList.remove('is-pane-resizing');
            this.onSplitRatioCommit?.(this.paneManager.getSplitRatio());
        };

        resizer.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
        this.cleanups.push(addClickHandler(resizer, () => {
            this.paneManager.setSplitRatio(DEFAULT_SPLIT_RATIO);
            this.onSplitRatioCommit?.(DEFAULT_SPLIT_RATIO);
        }, {
            shouldHandle: event => event.detail >= 2,
        }));
        this.cleanups.push(() => {
            resizer.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
        });
    }

    /**
     * 把 PaneManager 快照投影到固定左右布局。
     * @param {Object} snapshot - PaneManager 快照。
     */
    render(snapshot) {
        if (!snapshot || !this.elements) {
            return;
        }
        const isDual = snapshot.mode === PANE_LAYOUT_MODES.DUAL;
        const ratioPercent = `${snapshot.splitRatio * 100}%`;
        document.body.classList.toggle('is-dual-pane', isDual);
        this.elements.contentArea.style.setProperty('--primary-pane-width', ratioPercent);
        this.elements.headerRow.style.setProperty('--primary-pane-width', ratioPercent);
        this.elements.secondaryPane.setAttribute('aria-hidden', String(!isDual));
        this.elements.secondaryHeader.setAttribute('aria-hidden', String(!isDual));
        this.elements.resizer.setAttribute('aria-hidden', String(!isDual));
        this.elements.primaryPane.classList.toggle(
            'is-focused',
            snapshot.focusedPaneId === PANE_IDS.PRIMARY,
        );
        this.elements.secondaryPane.classList.toggle(
            'is-focused',
            isDual && snapshot.focusedPaneId === PANE_IDS.SECONDARY,
        );

        const secondaryPath = snapshot.panes.secondary.documentPath;
        const secondaryName = basename(secondaryPath) || '副栏';
        this.elements.secondaryTitleName.textContent = secondaryName;
        this.elements.secondaryTitle?.setAttribute('title', secondaryPath || '');
    }

    /**
     * 更新副栏标题中的未保存标记。
     * @param {boolean} dirty - 副栏文档是否 dirty。
     */
    setSecondaryDirty(dirty) {
        if (this.elements?.secondaryDirty) {
            this.elements.secondaryDirty.hidden = !dirty;
        }
    }

    /**
     * 解绑全部事件并清理临时布局状态。
     */
    destroy() {
        while (this.cleanups.length > 0) {
            const cleanup = this.cleanups.pop();
            try {
                cleanup?.();
            } catch (error) {
                console.warn('[PaneLayout] 清理失败', error);
            }
        }
        document.body.classList.remove('is-pane-resizing', 'is-dual-pane');
        this.elements = null;
        this.resizeState = null;
    }
}
