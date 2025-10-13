import { Editor, Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import MarkdownIt from 'markdown-it';
import TurndownService from 'turndown';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common as commonLanguages } from 'lowlight';
import shellCommandConfig from '../config/shell-commands.json';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import python from 'highlight.js/lib/languages/python';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';
import kotlin from 'highlight.js/lib/languages/kotlin';
import swift from 'highlight.js/lib/languages/swift';
import markdownLang from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import powershell from 'highlight.js/lib/languages/powershell';

const lowlight = createLowlight(commonLanguages);

const COPY_BUTTON_ICON = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="M9 9.75A2.25 2.25 0 0 1 11.25 7.5h7.5A2.25 2.25 0 0 1 21 9.75v7.5A2.25 2.25 0 0 1 18.75 19.5h-7.5A2.25 2.25 0 0 1 9 17.25v-7.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path><path d="M6 6.75A2.25 2.25 0 0 1 8.25 4.5h7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path><path d="M6 6.75A2.25 2.25 0 0 0 3.75 9v7.5A2.25 2.25 0 0 0 6 18.75h7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path></svg>';
const COPY_FEEDBACK_DURATION = 1600;
const COPY_BUTTON_OFFSET = 8;
const COPY_BUTTON_SIZE = 28;
const TASK_ITEM_TYPE = 'taskItem';
const TASK_LIST_TYPE = 'taskList';

const setAttribute = (token, name, value) => {
    if (!token) {
        return;
    }
    const index = token.attrIndex(name);
    if (index >= 0) {
        token.attrs[index][1] = value;
    } else {
        token.attrPush([name, value]);
    }
};

const findMatchingOpenIndex = (tokens, closeIndex, type) => {
    for (let i = closeIndex; i >= 0; i--) {
        if (tokens[i].type === type) {
            return i;
        }
    }
    return -1;
};

const taskListPlugin = md => {
    md.core.ruler.after('inline', 'task-list-items', state => {
        const tokens = state.tokens;
        for (let idx = 2; idx < tokens.length; idx++) {
            const inlineToken = tokens[idx];
            if (inlineToken.type !== 'inline') {
                continue;
            }
            const paragraphOpen = tokens[idx - 1];
            const listItemOpen = tokens[idx - 2];
            if (!paragraphOpen || paragraphOpen.type !== 'paragraph_open') {
                continue;
            }
            if (!listItemOpen || listItemOpen.type !== 'list_item_open') {
                continue;
            }
            if (!inlineToken.children || inlineToken.children.length === 0) {
                continue;
            }

            const firstChild = inlineToken.children[0];
            if (!firstChild || firstChild.type !== 'text') {
                continue;
            }

            const match = firstChild.content.match(/^\s*\[( |x|X)\]\s*/);
            if (!match) {
                continue;
            }

            const checked = match[1].toLowerCase() === 'x';

            firstChild.content = firstChild.content.slice(match[0].length).replace(/^\s+/, '');

            if (firstChild.content.length === 0) {
                inlineToken.children.shift();
            }

            setAttribute(listItemOpen, 'data-type', TASK_ITEM_TYPE);
            setAttribute(listItemOpen, 'data-checked', checked ? 'true' : 'false');

            for (let search = idx - 3; search >= 0; search--) {
                const token = tokens[search];
                const isListToken = token.type === 'bullet_list_open' || token.type === 'ordered_list_open';
                if (isListToken && token.level === listItemOpen.level - 1) {
                    setAttribute(token, 'data-type', TASK_LIST_TYPE);
                    break;
                }
            }
        }
    });

    const defaultListItemOpen =
        md.renderer.rules.list_item_open ||
        ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

    const defaultListItemClose =
        md.renderer.rules.list_item_close ||
        ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

    md.renderer.rules.list_item_open = (tokens, idx, options, env, self) => {
        const token = tokens[idx];
        if (token.attrGet('data-type') === TASK_ITEM_TYPE) {
            const attrs = self.renderAttrs(token);
            const checked = token.attrGet('data-checked') === 'true';
            const checkbox = `<input class="task-list-item-checkbox" type="checkbox"${checked ? ' checked' : ''} disabled />`;
            return `<li${attrs}><label class="task-list-item-label">${checkbox}<span class="task-list-item-indicator" aria-hidden="true"></span></label><div class="task-list-item-content">`;
        }
        return defaultListItemOpen(tokens, idx, options, env, self);
    };

    md.renderer.rules.list_item_close = (tokens, idx, options, env, self) => {
        const openIndex = findMatchingOpenIndex(tokens, idx, 'list_item_open');
        if (openIndex >= 0 && tokens[openIndex].attrGet('data-type') === TASK_ITEM_TYPE) {
            return '</div></li>';
        }
        return defaultListItemClose(tokens, idx, options, env, self);
    };
};

const extendBuiltInCommands = (languageFn, additionalCommands = []) => {
    return hljs => {
        const language = languageFn(hljs);

        if (language?.keywords?.built_in) {
            const builtIns = new Set(language.keywords.built_in);
            additionalCommands.forEach(command => builtIns.add(command));
            language.keywords.built_in = Array.from(builtIns);
        }

        if (Array.isArray(language?.contains)) {
            const assignmentRule = {
                className: 'variable',
                begin: /\b[A-Za-z_][A-Za-z0-9_]*\b(?=\s*=)/,
            };

            const hasAssignmentRule = language.contains.some(rule => {
                return rule.className === assignmentRule.className && String(rule.begin) === String(assignmentRule.begin);
            });

            if (!hasAssignmentRule) {
                language.contains = [assignmentRule, ...language.contains];
            }
        }

        return language;
    };
};

const additionalShellCommands = Array.isArray(shellCommandConfig?.commands)
    ? shellCommandConfig.commands
    : [];

lowlight.register({ bash: extendBuiltInCommands(bash, additionalShellCommands) });

const ensureLanguage = (name, fn) => {
    if (!lowlight.registered(name)) {
        lowlight.register({ [name]: fn });
    }
};

const ensureAlias = (language, alias) => {
    if (!lowlight.registered(alias)) {
        lowlight.registerAlias({ [language]: [alias] });
    }
};

[
    ['javascript', javascript, ['js', 'jsx']],
    ['typescript', typescript, ['ts', 'tsx']],
    ['json', json, []],
    ['bash', bash, []],
    ['shell', shell, ['sh']],
    ['python', python, ['py']],
    ['go', go, []],
    ['rust', rust, []],
    ['java', java, []],
    ['cpp', cpp, ['c++']],
    ['csharp', csharp, ['cs']],
    ['php', php, []],
    ['ruby', ruby, []],
    ['kotlin', kotlin, []],
    ['swift', swift, []],
    ['markdown', markdownLang, ['md']],
    ['yaml', yaml, ['yml']],
    ['xml', xml, ['html', 'htm']],
    ['css', css, []],
    ['scss', scss, []],
    ['sql', sql, []],
    ['powershell', powershell, ['ps', 'ps1']],
].forEach(([name, fn, aliases]) => {
    ensureLanguage(name, fn);
    aliases.forEach(alias => ensureAlias(name, alias));
});

const MarkdownImage = Node.create({
    name: 'image',
    inline: true,
    group: 'inline',
    draggable: true,
    selectable: true,
    addAttributes() {
        return {
            src: {
                default: null,
            },
            alt: {
                default: null,
            },
            title: {
                default: null,
            },
            dataOriginalSrc: {
                default: null,
                parseHTML: element => element.getAttribute('data-original-src'),
                renderHTML: attributes => {
                    if (!attributes.dataOriginalSrc) {
                        return {};
                    }
                    return { 'data-original-src': attributes.dataOriginalSrc };
                },
            },
        };
    },
    parseHTML() {
        return [
            {
                tag: 'img[src]',
            },
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return ['img', mergeAttributes(HTMLAttributes)];
    },
});

export class MarkdownEditor {
    constructor(element) {
        this.element = element;
        this.editor = null;
        this.currentFile = null;
        this.originalMarkdown = ''; // 保存原始 Markdown
        this.contentChanged = false;
        this.suppressUpdateEvent = false;
        this.copyButtonFrame = null;
        this.codeBlockCopyListeners = new Map();
        this.codeCopyButton = null;
        this.activeCopyTarget = null;
        this.copyButtonHideTimer = null;
        this.copyButtonViewportFrame = null;
        this.boundHandleViewportChange = () => this.handleCopyButtonViewportChange();
        this.handleCopyButtonMouseEnter = () => this.cancelCopyButtonHide();
        this.handleCopyButtonMouseLeave = () => this.scheduleCopyButtonHide();
        this.handleCopyButtonMouseDown = event => event.preventDefault();
        this.handleCopyButtonClick = event => {
            event.preventDefault();
            event.stopPropagation();
            void this.handleCodeCopy(event.currentTarget, this.activeCopyTarget);
        };

        // 配置 turndown 减少转义
        this.turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced',
            emDelimiter: '*',
            strongDelimiter: '**',
            bulletListMarker: '-',
        });

        // 禁用自动转义，保持原样
        this.turndownService.escape = function(string) {
            return string;
        };

        this.md = new MarkdownIt({
            html: true,
            breaks: true,
            linkify: true,
        });
        this.md.use(taskListPlugin);

        const trimCodeRenderer = renderer => {
            return (tokens, idx, options, env, self) => {
                const output = renderer ? renderer(tokens, idx, options, env, self) : '';
                return typeof output === 'string'
                    ? output.replace(/\r?\n(?=<\/code><\/pre>)/, '')
                    : output;
            };
        };

        this.md.renderer.rules.fence = trimCodeRenderer(this.md.renderer.rules.fence);
        this.md.renderer.rules.code_block = trimCodeRenderer(this.md.renderer.rules.code_block);

        this.turndownService.addRule('preserveImageOriginalSrc', {
            filter: 'img',
            replacement: (content, node) => {
                const alt = (node.getAttribute('alt') || '').replace(/]/g, '\\]');
                const title = node.getAttribute('title');
                const originalSrc = node.getAttribute('data-original-src') || node.getAttribute('src') || '';
                const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : '';
                const needsAngle = /\s|[<>]/.test(originalSrc);
                const escapedSrc = needsAngle ? `<${originalSrc.replace(/>/g, '\\>')}>` : originalSrc;
                return `![${alt}](${escapedSrc}${titlePart})`;
            },
        });
        this.turndownService.addRule('taskListItem', {
            filter: node => {
                if (!node || node.nodeName !== 'LI') {
                    return false;
                }
                const dataType = node.getAttribute('data-type') || (node.dataset ? node.dataset.type : null);
                return dataType === TASK_ITEM_TYPE;
            },
            replacement: (content, node, options) => {
                const checkedAttr = (node.getAttribute('data-checked') || (node.dataset ? node.dataset.checked : '') || '').toLowerCase();
                const hasCheckedInput = node.querySelector('input[type="checkbox"][checked]');
                const isChecked = checkedAttr === 'true' || (!checkedAttr && Boolean(hasCheckedInput));
                const checkboxMarker = isChecked ? 'x' : ' ';
                const prefix = `${options.bulletListMarker} [${checkboxMarker}] `;
                const normalized = content
                    .replace(/^\n+/, '')
                    .replace(/\n+$/, '\n')
                    .replace(/\n/gm, '\n' + ' '.repeat(prefix.length));
                const needsLineBreak = node.nextSibling && !/\n$/.test(normalized);
                return prefix + normalized + (needsLineBreak ? '\n' : '');
            },
        });
        this.init();
    }

    init() {
        this.editor = new Editor({
            element: this.element,
            extensions: [
                StarterKit.configure({
                    heading: {
                        levels: [1, 2, 3, 4, 5, 6],
                    },
                    codeBlock: false,
                }),
                TaskList.configure({
                    HTMLAttributes: {
                        class: 'task-list',
                    },
                }),
                TaskItem.configure({
                    nested: true,
                    HTMLAttributes: {
                        class: 'task-list-item',
                    },
                }),
                CodeBlockLowlight.configure({
                    lowlight,
                    HTMLAttributes: {
                        class: 'code-block hljs',
                    },
                }),
                MarkdownImage,
            ],
            content: '',
            editable: true,
            autofocus: true,
            editorProps: {
                attributes: {
                    class: 'tiptap-editor',
                },
            },
            onCreate: () => {
                this.scheduleCodeBlockCopyUpdate();
            },
            onUpdate: ({ editor }) => {
                this.scheduleCodeBlockCopyUpdate();
                // 标记内容已修改，但不自动保存
                if (this.suppressUpdateEvent) {
                    return;
                }
                this.contentChanged = true;
            },
        });
    }

    // 加载 Markdown 内容
    async setContent(markdown) {
        this.originalMarkdown = markdown; // 保存原始内容
        this.contentChanged = false;

        // 预处理：手动处理 ** 加粗
        const processed = this.preprocessBold(markdown);
        const html = this.md.render(processed);
        const resolvedHtml = await this.resolveImageSources(html);
        this.hideCodeCopyButton({ immediate: true });
        this.suppressUpdateEvent = true;
        try {
            this.editor.commands.setContent(resolvedHtml);
            // 设置光标到开头并滚动到顶部
            this.editor.commands.focus('start');
        } finally {
            this.suppressUpdateEvent = false;
        }
        this.scheduleCodeBlockCopyUpdate();
    }

    // 预处理加粗标记，支持中文和标点符号
    preprocessBold(markdown) {
        // 匹配 ** 包裹的内容，不管前后是什么字符
        return markdown.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    }

    // 获取 Markdown 格式的内容
    getMarkdown() {
        // 如果内容未修改，返回原始 Markdown
        if (!this.contentChanged) {
            return this.originalMarkdown;
        }
        // 内容修改了，才转换
        const html = this.editor.getHTML();
        return this.turndownService.turndown(html);
    }

    // 手动保存
    async save() {
        if (!this.currentFile) return;

        try {
            const { invoke } = await import('@tauri-apps/api/core');
            const markdown = this.getMarkdown();
            await invoke('write_file', {
                path: this.currentFile,
                content: markdown
            });
            // 保存后更新原始内容
            this.originalMarkdown = markdown;
            this.contentChanged = false;
            console.log('保存成功');
            return true;
        } catch (error) {
            console.error('保存失败:', error);
            return false;
        }
    }

    // 加载文件
    async loadFile(filePath, content) {
        this.currentFile = filePath;
        await this.setContent(content);
    }

    // AI 生成内容插入
    insertAIContent(content) {
        this.editor.commands.insertContent(content);
        this.scheduleCodeBlockCopyUpdate();
    }

    // 销毁编辑器
    destroy() {
        this.cancelScheduledCodeBlockCopyUpdate();
        this.teardownCodeBlockCopyInfrastructure();
        if (this.editor) {
            this.editor.destroy();
        }
    }

    clear() {
        this.currentFile = null;
        this.originalMarkdown = '';
        this.contentChanged = false;
        if (!this.editor) {
            return;
        }
        this.suppressUpdateEvent = true;
        try {
            this.editor.commands.setContent('');
        } finally {
            this.suppressUpdateEvent = false;
        }
        this.hideCodeCopyButton({ immediate: true });
        this.scheduleCodeBlockCopyUpdate();
    }

    hasUnsavedChanges() {
        return !!this.contentChanged;
    }

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

    cancelScheduledCodeBlockCopyUpdate() {
        if (this.copyButtonFrame === null) {
            return;
        }
        if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
            window.cancelAnimationFrame(this.copyButtonFrame);
        }
        this.copyButtonFrame = null;
    }

    ensureCodeBlockCopyListeners() {
        if (!this.element || typeof document === 'undefined') {
            return;
        }

        this.ensureCodeCopyButton();

        const codeBlocks = Array.from(this.element.querySelectorAll('pre'));
        if (codeBlocks.length === 0) {
            this.hideCodeCopyButton({ immediate: true });
        }

        const seen = new Set();
        codeBlocks.forEach(pre => {
            seen.add(pre);
            if (this.codeBlockCopyListeners.has(pre)) {
                return;
            }

            const handlers = {
                mouseenter: () => this.handleCodeBlockMouseEnter(pre),
                mouseleave: () => this.handleCodeBlockMouseLeave(pre),
            };

            pre.addEventListener('mouseenter', handlers.mouseenter);
            pre.addEventListener('mouseleave', handlers.mouseleave);
            this.codeBlockCopyListeners.set(pre, handlers);
        });

        for (const [pre, handlers] of this.codeBlockCopyListeners.entries()) {
            if (!pre.isConnected || !seen.has(pre)) {
                pre.removeEventListener('mouseenter', handlers.mouseenter);
                pre.removeEventListener('mouseleave', handlers.mouseleave);
                this.codeBlockCopyListeners.delete(pre);
                if (this.activeCopyTarget === pre) {
                    this.hideCodeCopyButton({ immediate: true });
                }
            }
        }
    }

    handleCodeBlockMouseEnter(pre) {
        if (!pre) {
            return;
        }
        this.cancelCopyButtonHide();
        this.activeCopyTarget = pre;
        this.showCodeCopyButton(pre);
    }

    handleCodeBlockMouseLeave(pre) {
        if (!pre) {
            return;
        }
        this.scheduleCopyButtonHide(140);
    }

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
        button.addEventListener('mousedown', this.handleCopyButtonMouseDown);
        button.addEventListener('click', this.handleCopyButtonClick);

        if (!document.body) {
            return;
        }

        document.body.appendChild(button);

        this.codeCopyButton = button;

        if (typeof window !== 'undefined') {
            window.addEventListener('scroll', this.boundHandleViewportChange, true);
            window.addEventListener('resize', this.boundHandleViewportChange);
        }
    }

    showCodeCopyButton(pre) {
        if (!this.codeCopyButton) {
            return;
        }
        this.positionCodeCopyButton(pre);
        this.codeCopyButton.classList.add('is-visible');
    }

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

    cancelCopyButtonHide() {
        if (this.copyButtonHideTimer) {
            clearTimeout(this.copyButtonHideTimer);
            this.copyButtonHideTimer = null;
        }
    }

    positionCodeCopyButton(pre) {
        if (!this.codeCopyButton || !pre) {
            return;
        }

        const rect = pre.getBoundingClientRect();
        const buttonWidth = this.codeCopyButton.offsetWidth || COPY_BUTTON_SIZE;

        const offsetTop = Math.max(COPY_BUTTON_OFFSET, rect.top + COPY_BUTTON_OFFSET);
        const offsetLeft = Math.min(
            window.innerWidth - buttonWidth - COPY_BUTTON_OFFSET,
            rect.right - buttonWidth - COPY_BUTTON_OFFSET
        );

        const top = Math.max(COPY_BUTTON_OFFSET, offsetTop);
        const left = Math.max(COPY_BUTTON_OFFSET, offsetLeft);

        this.codeCopyButton.style.top = `${top}px`;
        this.codeCopyButton.style.left = `${left}px`;
    }

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

    teardownCodeBlockCopyInfrastructure() {
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
            this.codeCopyButton.removeEventListener('mousedown', this.handleCopyButtonMouseDown);
            this.codeCopyButton.removeEventListener('click', this.handleCopyButtonClick);
            this.codeCopyButton.remove();
            this.codeCopyButton = null;
        }

        if (typeof window !== 'undefined') {
            window.removeEventListener('scroll', this.boundHandleViewportChange, true);
            window.removeEventListener('resize', this.boundHandleViewportChange);
        }

        this.activeCopyTarget = null;
    }

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

    async resolveImageSources(html) {
        if (!html || !this.currentFile) {
            return html;
        }

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const isWindows = this.isWindowsPath(this.currentFile);

            const images = Array.from(doc.querySelectorAll('img'));

            for (const img of images) {
                const originalSrc = img.getAttribute('src');
                if (!originalSrc) {
                    continue;
                }

                img.setAttribute('data-original-src', originalSrc);

                if (this.isExternalImageSrc(originalSrc)) {
                    continue;
                }

                const resolvedPath = this.resolveImagePath(originalSrc, isWindows);
                if (!resolvedPath) {
                    continue;
                }

                try {
                    const binary = await this.readBinaryFromFs(resolvedPath);
                    const dataUri = this.binaryToDataUri(binary, resolvedPath);
                    img.setAttribute('src', dataUri);
                } catch (error) {
                    console.error('读取图片失败:', {
                        resolvedPath,
                        message: error?.message,
                        error,
                    });
                }
            }

            return doc.body.innerHTML;
        } catch (error) {
            console.error('解析图片 HTML 失败:', error);
            return html;
        }
    }

    isExternalImageSrc(src) {
        const trimmed = src.trim();
        if (!trimmed) return true;
        return /^(?:https?:|data:|blob:|tauri:|asset:|about:|javascript:)/i.test(trimmed) || trimmed.startsWith('//');
    }

    resolveImagePath(src, isWindows) {
        const trimmed = src.trim();
        if (!trimmed) {
            return null;
        }

        if (trimmed.startsWith('file://')) {
            return this.fileUrlToPath(trimmed, isWindows);
        }

        if (this.isAbsoluteLocalPath(trimmed)) {
            return this.normalizeAbsolutePath(trimmed, isWindows);
        }

        const baseDir = this.getCurrentDirectory();
        if (!baseDir) {
            return null;
        }

        return this.joinPaths(baseDir, trimmed, isWindows);
    }

    getCurrentDirectory() {
        if (!this.currentFile) return null;
        const normalized = this.currentFile.replace(/\\/g, '/');
        const lastSlash = normalized.lastIndexOf('/');
        if (lastSlash === -1) {
            return null;
        }
        return normalized.slice(0, lastSlash);
    }

    isAbsoluteLocalPath(path) {
        return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(path);
    }

    normalizeAbsolutePath(path, isWindows) {
        if (isWindows) {
            if (/^\\\\/.test(path)) {
                return path;
            }
            if (/^file:/.test(path)) {
                return this.fileUrlToPath(path, true);
            }
            if (/^[A-Za-z]:/.test(path)) {
                return path.replace(/\//g, '\\');
            }
            if (path.startsWith('/')) {
                return path.replace(/\//g, '\\');
            }
            return path;
        }

        return path.replace(/\\/g, '/');
    }

    joinPaths(baseDir, relativePath, isWindows) {
        try {
            const sanitizedRelative = relativePath.replace(/\\/g, '/');
            const baseUrl = new URL(this.pathToFileUrl(baseDir) + '/');
            const resolvedUrl = new URL(sanitizedRelative, baseUrl);
            return this.urlToFsPath(resolvedUrl, isWindows);
        } catch (error) {
            console.error('组合图片路径失败:', { baseDir, relativePath, error });
            return null;
        }
    }

    pathToFileUrl(path) {
        const normalized = path.replace(/\\/g, '/');
        if (/^[A-Za-z]:/.test(normalized)) {
            return `file:///${normalized}`;
        }
        if (normalized.startsWith('//')) {
            return `file://${normalized.slice(2)}`;
        }
        if (normalized.startsWith('/')) {
            return `file://${normalized}`;
        }
        return `file://${normalized}`;
    }

    fileUrlToPath(urlString, isWindows) {
        try {
            const url = new URL(urlString);
            return this.urlToFsPath(url, isWindows);
        } catch (error) {
            console.error('解析 file:// 路径失败:', { urlString, error });
            return null;
        }
    }

    urlToFsPath(url, isWindows) {
        if (url.protocol !== 'file:') {
            return null;
        }

        let pathname = decodeURIComponent(url.pathname);

        if (url.host) {
            const networkPath = `${url.host}${pathname}`;
            if (isWindows) {
                return `\\\\${networkPath.replace(/\//g, '\\')}`;
            }
            return `//${networkPath}`;
        }

        if (isWindows && /^\/[A-Za-z]:/.test(pathname)) {
            pathname = pathname.slice(1);
        }

        if (isWindows) {
            return pathname.replace(/\//g, '\\');
        }
        return pathname;
    }

    isWindowsPath(path) {
        return /^[A-Za-z]:[\\/]/.test(path) || /\\/.test(path);
    }

    binaryToDataUri(binary, path) {
        const bytes = binary instanceof Uint8Array ? binary : new Uint8Array(binary);
        const chunkSize = 0x8000;
        let binaryString = '';
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            binaryString += String.fromCharCode.apply(null, chunk);
        }
        const base64 = btoa(binaryString);
        const mime = this.detectMimeType(path);
        return `data:${mime};base64,${base64}`;
    }

    detectMimeType(path) {
        const lowerPath = path.toLowerCase();
        if (lowerPath.endsWith('.png')) return 'image/png';
        if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) return 'image/jpeg';
        if (lowerPath.endsWith('.gif')) return 'image/gif';
        if (lowerPath.endsWith('.webp')) return 'image/webp';
        if (lowerPath.endsWith('.svg')) return 'image/svg+xml';
        if (lowerPath.endsWith('.bmp')) return 'image/bmp';
        if (lowerPath.endsWith('.ico')) return 'image/x-icon';
        return 'application/octet-stream';
    }

    async readBinaryFromFs(path) {
        try {
            const { readFile } = await import('@tauri-apps/plugin-fs');
            return readFile(path);
        } catch (error) {
            const fsApi = window?.__TAURI__?.fs;
            if (fsApi?.readBinaryFile) {
                return fsApi.readBinaryFile(path);
            }
            throw error;
        }
    }
}
