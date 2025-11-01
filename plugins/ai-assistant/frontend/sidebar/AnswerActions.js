const COPY_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#747474" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const INSERT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#747474" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
const REPLACE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#747474" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>';

export class AnswerActions {
    constructor(sidebar) {
        this.sidebar = sidebar;
        this.copyFeedbackTimer = null;
    }

    render(entry) {
        if (!entry?.dom?.element) {
            return;
        }

        const { element } = entry.dom;

        let actions = element.querySelector('.ai-message__actions');
        if (!actions) {
            actions = document.createElement('div');
            actions.className = 'ai-message__actions';
            element.appendChild(actions);
        } else {
            actions.innerHTML = '';
        }

        const answerText = entry.content || '';
        const buttons = [
            { label: '复制 Markdown', icon: COPY_ICON, onClick: (btn) => this.copyAnswer(answerText, btn) },
            { label: '插入到光标', icon: INSERT_ICON, onClick: () => this.insertAnswer(answerText) },
            { label: '替换所选内容', icon: REPLACE_ICON, onClick: () => this.replaceSelection(answerText) },
        ];

        buttons.forEach(({ label, icon, onClick }) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ai-message__action-btn';
            btn.innerHTML = icon;
            btn.setAttribute('aria-label', label);
            btn.title = label;
            btn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                void onClick(btn);
            });
            actions.appendChild(btn);
        });
    }

    async copyAnswer(answerText, button) {
        const text = (answerText || '').trim();
        if (!text) {
            this.sidebar.showToast('没有可复制的内容', 'warning');
            return;
        }

        try {
            if (window?.navigator?.clipboard?.writeText) {
                await window.navigator.clipboard.writeText(text);
            } else if (window?.__TAURI__?.clipboard?.writeText) {
                await window.__TAURI__.clipboard.writeText(text);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.setAttribute('readonly', '');
                textarea.style.position = 'absolute';
                textarea.style.left = '-9999px';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }
            this.sidebar.showToast('已复制到剪贴板', 'success');
            this.markCopyState(button, 'success');
        } catch (error) {
            console.warn('[AnswerActions] 复制失败', error);
            this.sidebar.showToast('复制失败', 'error');
            this.markCopyState(button, 'error');
        }
    }

    async insertAnswer(answerText) {
        const text = (answerText || '').trim();
        if (!text) {
            this.sidebar.showToast('没有可插入的内容', 'warning');
            return;
        }

        try {
            const markdownEditor = this.sidebar.editorRefs?.markdownEditor;
            console.log('[AnswerActions] insertAnswer editorRefs', this.sidebar.editorRefs);
            if (markdownEditor?.insertTextAtCursor) {
                console.log('[AnswerActions] calling insertTextAtCursor');
                markdownEditor.insertTextAtCursor(text);
                this.sidebar.showToast('已插入到光标位置', 'success');
                return;
            }
        } catch (error) {
            console.warn('[AnswerActions] markdownEditor.insertTextAtCursor 调用失败', error);
        }

        try {
            if (typeof this.sidebar.app?.insertText === 'function') {
                await this.sidebar.app.insertText(text, { position: 'cursor' });
                this.sidebar.showToast('已插入到光标位置', 'success');
                return;
            }
        } catch (error) {
            console.warn('[AnswerActions] app.insertText 调用失败', error);
        }

        this.sidebar.showToast('无法插入内容，请检查编辑器状态', 'error');
    }

    async replaceSelection(answerText) {
        const text = (answerText || '').trim();
        if (!text) {
            this.sidebar.showToast('没有可替换的内容', 'warning');
            return;
        }

        if (typeof this.sidebar.app?.replaceSelection === 'function') {
            try {
                if (typeof this.sidebar.app?.getSelectedText === 'function') {
                    const selected = await this.sidebar.app.getSelectedText();
                    if (!selected) {
                        this.sidebar.showToast('请先在文档中选中需要替换的内容', 'warning');
                        return;
                    }
                }
                await this.sidebar.app.replaceSelection(text);
                this.sidebar.showToast('已替换选中文本', 'success');
                return;
            } catch (error) {
                console.warn('[AnswerActions] replaceSelection 调用失败', error);
            }
        }

        this.sidebar.showToast('无法替换选区，请检查编辑器状态', 'error');
    }

    markCopyState(button, state) {
        if (!button) return;

        button.classList.remove('is-success', 'is-error');
        if (state === 'success') {
            button.classList.add('is-success');
        } else if (state === 'error') {
            button.classList.add('is-error');
        }

        if (this.copyFeedbackTimer) {
            clearTimeout(this.copyFeedbackTimer);
        }

        this.copyFeedbackTimer = setTimeout(() => {
            button.classList.remove('is-success', 'is-error');
        }, 1600);
    }
}
