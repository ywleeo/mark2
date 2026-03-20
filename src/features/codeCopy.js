// 代码块复制功能模块
import { addClickHandler } from '../utils/PointerHelper.js';

// 常量配置
const COPY_BUTTON_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fcfcfcff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const COPY_FEEDBACK_DURATION = 1600;
const COPY_BUTTON_OFFSET = 8;
const COPY_BUTTON_SIZE = 28;

// 代码复制管理类
export class CodeCopyManager {
    constructor(containerElement) {
        this.element = containerElement;
        this.copyButtonFrame = null;
        this.codeBlockCopyListeners = new Map();
        this.codeCopyButton = null;
        this.activeCopyTarget = null;
        this.copyButtonHideTimer = null;
        this.copyButtonViewportFrame = null;
        this.copyButtonClickCleanup = null;
        this._observer = null;

        // 绑定方法
        this.boundHandleViewportChange = () => this.handleCopyButtonViewportChange();
        this.handleCopyButtonMouseEnter = () => this.cancelCopyButtonHide();
        this.handleCopyButtonMouseLeave = () => this.scheduleCopyButtonHide();

        // 启动 MutationObserver 增量监听 pre 元素变化
        this._startObserver();
    }

    // 启动 MutationObserver，增量处理 pre 元素的新增/移除
    _startObserver() {
        if (!this.element || typeof MutationObserver === 'undefined') {
            return;
        }
        this._observer = new MutationObserver((mutations) => {
            let hasChanges = false;
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.nodeName === 'PRE') {
                        this._attachPre(node);
                        hasChanges = true;
                    } else if (node.querySelectorAll) {
                        for (const pre of node.querySelectorAll('pre')) {
                            this._attachPre(pre);
                            hasChanges = true;
                        }
                    }
                }
                for (const node of mutation.removedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.nodeName === 'PRE') {
                        this._detachPre(node);
                        hasChanges = true;
                    } else if (node.querySelectorAll) {
                        for (const pre of node.querySelectorAll('pre')) {
                            this._detachPre(pre);
                            hasChanges = true;
                        }
                    }
                }
            }
            if (hasChanges && this.codeBlockCopyListeners.size === 0) {
                this.hideCodeCopyButton({ immediate: true });
            }
        });
        this._observer.observe(this.element, { childList: true, subtree: true });
    }

    // 为单个 pre 元素附加 hover 监听器
    _attachPre(pre) {
        if (this.codeBlockCopyListeners.has(pre)) {
            return;
        }
        this.ensureCodeCopyButton();
        const handlers = {
            mouseenter: () => this.handleCodeBlockMouseEnter(pre),
            mouseleave: () => this.handleCodeBlockMouseLeave(pre),
        };
        pre.addEventListener('mouseenter', handlers.mouseenter);
        pre.addEventListener('mouseleave', handlers.mouseleave);
        this.codeBlockCopyListeners.set(pre, handlers);
    }

    // 移除单个 pre 元素的 hover 监听器
    _detachPre(pre) {
        const handlers = this.codeBlockCopyListeners.get(pre);
        if (!handlers) {
            return;
        }
        pre.removeEventListener('mouseenter', handlers.mouseenter);
        pre.removeEventListener('mouseleave', handlers.mouseleave);
        this.codeBlockCopyListeners.delete(pre);
        if (this.activeCopyTarget === pre) {
            this.hideCodeCopyButton({ immediate: true });
        }
    }

    // 调度代码块复制监听器更新（用于初始化和强制刷新）
    scheduleCodeBlockCopyUpdate() {
        if (this.copyButtonFrame !== null) {
            return;
        }
        if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
            this.ensureCodeBlockCopyListeners();
            return;
        }
        this.copyButtonFrame = window.requestAnimationFrame(() => {
            this.copyButtonFrame = null;
            this.ensureCodeBlockCopyListeners();
        });
    }

    // 取消已调度的更新
    cancelScheduledCodeBlockCopyUpdate() {
        if (this.copyButtonFrame === null) {
            return;
        }
        if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
            window.cancelAnimationFrame(this.copyButtonFrame);
        }
        this.copyButtonFrame = null;
    }

    // 全量同步（初始化 / 文件切换时调用）
    ensureCodeBlockCopyListeners() {
        if (!this.element || typeof document === 'undefined') {
            return;
        }

        this.ensureCodeCopyButton();

        const codeBlocks = this.element.querySelectorAll('pre');
        if (codeBlocks.length === 0) {
            this.hideCodeCopyButton({ immediate: true });
        }

        const seen = new Set();
        for (const pre of codeBlocks) {
            seen.add(pre);
            this._attachPre(pre);
        }

        for (const [pre] of this.codeBlockCopyListeners) {
            if (!pre.isConnected || !seen.has(pre)) {
                this._detachPre(pre);
            }
        }
    }

    // 处理代码块鼠标进入
    handleCodeBlockMouseEnter(pre) {
        if (!pre) {
            return;
        }
        this.cancelCopyButtonHide();
        this.activeCopyTarget = pre;
        this.showCodeCopyButton(pre);
    }

    // 处理代码块鼠标离开
    handleCodeBlockMouseLeave(pre) {
        if (!pre) {
            return;
        }
        this.scheduleCopyButtonHide(140);
    }

    // 确保复制按钮存在
    ensureCodeCopyButton() {
        if (this.codeCopyButton || typeof document === 'undefined') {
            return;
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'code-copy-button';
        button.innerHTML = COPY_BUTTON_ICON;
        button.setAttribute('aria-label', '复制代码');
        button.setAttribute('title', '复制代码');

        button.addEventListener('mouseenter', this.handleCopyButtonMouseEnter);
        button.addEventListener('mouseleave', this.handleCopyButtonMouseLeave);

        // 使用 PointerHelper 处理点击事件
        this.copyButtonClickCleanup = addClickHandler(button, () => {
            void this.handleCodeCopy(button, this.activeCopyTarget);
        }, { preventDefault: true });

        if (!this.element) {
            return;
        }

        // 确保容器有正确的定位上下文
        const containerStyle = window.getComputedStyle(this.element);
        if (containerStyle.position === 'static') {
            this.element.style.position = 'relative';
        }

        this.element.appendChild(button);

        this.codeCopyButton = button;

        if (typeof window !== 'undefined') {
            window.addEventListener('scroll', this.boundHandleViewportChange, true);
            window.addEventListener('resize', this.boundHandleViewportChange);
        }
    }

    // 显示复制按钮
    showCodeCopyButton(pre) {
        if (!this.codeCopyButton) {
            return;
        }
        this.positionCodeCopyButton(pre);
        this.codeCopyButton.classList.add('is-visible');
    }

    // 隐藏复制按钮
    hideCodeCopyButton(options = {}) {
        const { immediate = false } = options;
        if (!this.codeCopyButton) {
            return;
        }

        if (immediate) {
            this.codeCopyButton.classList.remove('is-visible', 'copy-success', 'copy-error');
            this.codeCopyButton.style.top = '-9999px';
            this.codeCopyButton.style.left = '-9999px';
        } else {
            this.codeCopyButton.classList.remove('is-visible');
        }

        this.activeCopyTarget = null;
    }

    // 调度隐藏复制按钮
    scheduleCopyButtonHide(delay = 120) {
        this.cancelCopyButtonHide();
        this.copyButtonHideTimer = setTimeout(() => {
            if (!this.codeCopyButton) {
                return;
            }
            if (this.codeCopyButton.matches(':hover')) {
                return;
            }
            this.hideCodeCopyButton();
        }, delay);
    }

    // 取消隐藏复制按钮
    cancelCopyButtonHide() {
        if (this.copyButtonHideTimer) {
            clearTimeout(this.copyButtonHideTimer);
            this.copyButtonHideTimer = null;
        }
    }

    // 定位复制按钮
    positionCodeCopyButton(pre) {
        if (!this.codeCopyButton || !pre || !this.element) {
            return;
        }

        const preRect = pre.getBoundingClientRect();
        const containerRect = this.element.getBoundingClientRect();
        const buttonWidth = this.codeCopyButton.offsetWidth || COPY_BUTTON_SIZE;

        // 计算 pre 相对于容器的位置
        const relativeTop = preRect.top - containerRect.top + this.element.scrollTop;
        const relativeRight = preRect.right - containerRect.left;

        const top = relativeTop + COPY_BUTTON_OFFSET;
        const left = relativeRight - buttonWidth - COPY_BUTTON_OFFSET;

        this.codeCopyButton.style.top = `${top}px`;
        this.codeCopyButton.style.left = `${left}px`;
    }

    // 处理视口变化
    handleCopyButtonViewportChange() {
        if (!this.activeCopyTarget || !this.codeCopyButton) {
            return;
        }

        if (this.copyButtonViewportFrame !== null) {
            return;
        }

        if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
            if (this.activeCopyTarget.isConnected) {
                this.positionCodeCopyButton(this.activeCopyTarget);
            } else {
                this.hideCodeCopyButton({ immediate: true });
            }
            return;
        }

        this.copyButtonViewportFrame = window.requestAnimationFrame(() => {
            this.copyButtonViewportFrame = null;
            if (!this.activeCopyTarget || !this.activeCopyTarget.isConnected) {
                this.hideCodeCopyButton({ immediate: true });
                return;
            }
            this.positionCodeCopyButton(this.activeCopyTarget);
        });
    }

    // 清理所有基础设施
    teardownCodeBlockCopyInfrastructure() {
        if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
        }
        this.cancelCopyButtonHide();
        if (this.copyButtonViewportFrame !== null && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
            window.cancelAnimationFrame(this.copyButtonViewportFrame);
            this.copyButtonViewportFrame = null;
        }
        this.hideCodeCopyButton({ immediate: true });

        for (const [pre, handlers] of this.codeBlockCopyListeners.entries()) {
            pre.removeEventListener('mouseenter', handlers.mouseenter);
            pre.removeEventListener('mouseleave', handlers.mouseleave);
        }
        this.codeBlockCopyListeners.clear();

        if (this.codeCopyButton) {
            if (this.codeCopyButton._copyFeedbackTimer) {
                clearTimeout(this.codeCopyButton._copyFeedbackTimer);
                this.codeCopyButton._copyFeedbackTimer = null;
            }
            this.codeCopyButton.removeEventListener('mouseenter', this.handleCopyButtonMouseEnter);
            this.codeCopyButton.removeEventListener('mouseleave', this.handleCopyButtonMouseLeave);

            // 清理 PointerHelper 的点击处理
            if (this.copyButtonClickCleanup) {
                this.copyButtonClickCleanup();
                this.copyButtonClickCleanup = null;
            }

            this.codeCopyButton.remove();
            this.codeCopyButton = null;
        }

        if (typeof window !== 'undefined') {
            window.removeEventListener('scroll', this.boundHandleViewportChange, true);
            window.removeEventListener('resize', this.boundHandleViewportChange);
        }

        this.activeCopyTarget = null;
    }

    // 处理代码复制
    async handleCodeCopy(button, preOverride = null) {
        const pre = preOverride ?? button?.closest?.('pre');
        if (!pre) {
            this.applyCopyButtonFeedback(button, 'error');
            return;
        }

        const codeElement = pre.querySelector('code');
        if (!codeElement) {
            this.applyCopyButtonFeedback(button, 'error');
            return;
        }

        const text = codeElement.textContent ?? '';
        if (!text) {
            this.applyCopyButtonFeedback(button, 'error');
            return;
        }

        try {
            await this.copyTextToClipboard(text);
            this.applyCopyButtonFeedback(button, 'success');
        } catch (error) {
            console.error('复制代码失败:', error);
            this.applyCopyButtonFeedback(button, 'error');
        }
    }

    // 复制文本到剪贴板
    async copyTextToClipboard(text) {
        if (!text) {
            throw new Error('无法复制空内容');
        }

        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }

        if (typeof window !== 'undefined' && window.__TAURI__?.clipboard?.writeText) {
            await window.__TAURI__.clipboard.writeText(text);
            return;
        }

        this.copyTextWithExecCommand(text);
    }

    // 使用 execCommand 复制文本(降级方案)
    copyTextWithExecCommand(text) {
        if (!document?.body) {
            throw new Error('剪贴板不可用');
        }

        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '-9999px';
        textarea.style.left = '-9999px';
        textarea.style.opacity = '0';

        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();

        try {
            const successful = document.execCommand('copy');
            if (!successful) {
                throw new Error('execCommand 复制失败');
            }
        } finally {
            document.body.removeChild(textarea);
        }
    }

    // 应用复制按钮反馈效果
    applyCopyButtonFeedback(button, status) {
        this.cancelCopyButtonHide();
        button.classList.remove('copy-success', 'copy-error');
        if (status === 'success') {
            button.classList.add('copy-success');
        } else if (status === 'error') {
            button.classList.add('copy-error');
        }

        if (button._copyFeedbackTimer) {
            clearTimeout(button._copyFeedbackTimer);
        }

        button._copyFeedbackTimer = setTimeout(() => {
            button.classList.remove('copy-success', 'copy-error');
            button._copyFeedbackTimer = null;
        }, COPY_FEEDBACK_DURATION);

        if (status === 'success') {
            this.scheduleCopyButtonHide(COPY_FEEDBACK_DURATION);
        } else if (status === 'error') {
            this.scheduleCopyButtonHide(600);
        }
    }

    // 销毁
    destroy() {
        this.cancelScheduledCodeBlockCopyUpdate();
        this.teardownCodeBlockCopyInfrastructure();
    }
}
