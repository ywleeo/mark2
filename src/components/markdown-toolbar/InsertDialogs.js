/**
 * 链接 / 图片 / 视频插入对话框
 * 用友好的输入界面替代「往文档塞 Markdown 骨架让用户改占位符」。
 * 仿 SheetPickerDialog 的 overlay + Promise 模式。
 */
import { addClickHandler } from '../../utils/PointerHelper.js';
import { t } from '../../i18n/index.js';

/** 支持选择的本地图片扩展名 */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'];

/** 支持选择的本地视频扩展名 */
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'ogv', 'mov', 'm4v', 'mkv'];

/**
 * 计算 toPath 相对 fromDir 的路径；无公共前缀（不同盘符/根）时返回 null。
 */
function toRelativePath(fromDir, toPath) {
    const from = fromDir.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean);
    const to = toPath.replace(/\\/g, '/').split('/').filter(Boolean);
    let i = 0;
    while (i < from.length && i < to.length && from[i] === to[i]) i++;
    if (i === 0) return null;
    const ups = from.length - i;
    return [...Array(ups).fill('..'), ...to.slice(i)].join('/') || '.';
}

/**
 * 把选中的本地文件绝对路径转成可写入文档的路径：
 * 能算出相对路径就用相对（可移植），否则退回绝对路径。
 */
function toInsertablePath(absPath, currentDir) {
    if (!currentDir) return absPath;
    const rel = toRelativePath(currentDir, absPath);
    return rel || absPath;
}

/**
 * 弹系统文件选择器选本地文件，返回可写入文档的路径（取消返回 null）。
 * @param {string|null} currentDir - 当前文档目录，用于换算相对路径
 * @param {Array|null} filters - Tauri open 的文件类型过滤；null 表示不限类型
 */
async function pickLocalPath(currentDir, filters = null) {
    try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({
            multiple: false,
            directory: false,
            ...(filters ? { filters } : {}),
        });
        if (!selected || typeof selected !== 'string') return null;
        return toInsertablePath(selected, currentDir);
    } catch (error) {
        console.error('选择本地文件失败:', error);
        return null;
    }
}

/**
 * 通用输入对话框
 * @param {{title:string, fields:Array}} config - fields: { key, label, value, placeholder, button? }
 * @returns {Promise<object|null>} 确定返回 { [key]: value }，取消返回 null
 */
function showInputDialog({ title, fields }) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'tb-dialog-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'tb-dialog';

        const titleEl = document.createElement('div');
        titleEl.className = 'tb-dialog__title';
        titleEl.textContent = title;
        dialog.appendChild(titleEl);

        const inputs = {};
        for (const field of fields) {
            const fieldEl = document.createElement('div');
            fieldEl.className = 'tb-dialog__field';

            const label = document.createElement('label');
            label.className = 'tb-dialog__label';
            label.textContent = field.label;
            fieldEl.appendChild(label);

            const row = document.createElement('div');
            row.className = 'tb-dialog__input-row';

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'tb-dialog__input';
            input.value = field.value || '';
            input.placeholder = field.placeholder || '';
            row.appendChild(input);
            inputs[field.key] = input;

            if (field.button) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'tb-dialog__browse';
                btn.textContent = field.button.label;
                addClickHandler(btn, async () => {
                    await field.button.onClick((val) => {
                        input.value = val;
                        input.focus();
                    });
                });
                row.appendChild(btn);
            }

            fieldEl.appendChild(row);
            dialog.appendChild(fieldEl);
        }

        const actions = document.createElement('div');
        actions.className = 'tb-dialog__actions';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'tb-dialog__btn tb-dialog__btn--cancel';
        cancelBtn.textContent = t('toolbar.dialogCancel');

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'tb-dialog__btn tb-dialog__btn--confirm';
        confirmBtn.textContent = t('toolbar.dialogOk');

        actions.append(cancelBtn, confirmBtn);
        dialog.appendChild(actions);

        const collect = () => {
            const result = {};
            for (const key of Object.keys(inputs)) {
                result[key] = inputs[key].value.trim();
            }
            return result;
        };

        const cleanup = () => {
            document.removeEventListener('keydown', onKeydown, true);
            overlay.remove();
        };
        const done = (value) => {
            cleanup();
            resolve(value);
        };
        function onKeydown(e) {
            if (e.isComposing) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                done(null);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                done(collect());
            }
        }

        addClickHandler(cancelBtn, () => done(null));
        addClickHandler(confirmBtn, () => done(collect()));
        addClickHandler(overlay, (e) => {
            if (e.target === overlay) done(null);
        });
        document.addEventListener('keydown', onKeydown, true);

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const firstInput = inputs[fields[0]?.key];
        if (firstInput) {
            firstInput.focus();
            firstInput.select();
        }
    });
}

/**
 * 插入链接对话框（支持选本地文件）
 * @returns {Promise<{url:string, text:string}|null>}
 */
export function showLinkDialog({ url = '', text = '', currentDir = null } = {}) {
    return showInputDialog({
        title: t('toolbar.linkDialogTitle'),
        fields: [
            {
                key: 'url',
                label: t('toolbar.linkDialogUrl'),
                value: url,
                placeholder: 'https://',
                button: {
                    label: t('toolbar.dialogBrowse'),
                    onClick: async (setValue) => {
                        const picked = await pickLocalPath(currentDir);
                        if (picked) setValue(picked);
                    },
                },
            },
            { key: 'text', label: t('toolbar.linkDialogText'), value: text, placeholder: t('toolbar.linkDialogTextHint') },
        ],
    });
}

/**
 * 插入图片对话框（支持选本地文件）
 * @returns {Promise<{url:string, alt:string}|null>}
 */
export function showImageDialog({ url = '', alt = '', currentDir = null } = {}) {
    return showInputDialog({
        title: t('toolbar.imageDialogTitle'),
        fields: [
            {
                key: 'url',
                label: t('toolbar.imageDialogUrl'),
                value: url,
                placeholder: 'https://',
                button: {
                    label: t('toolbar.dialogBrowse'),
                    onClick: async (setValue) => {
                        const picked = await pickLocalPath(currentDir, [
                            { name: t('toolbar.imageDialogFilter'), extensions: IMAGE_EXTENSIONS },
                        ]);
                        if (picked) setValue(picked);
                    },
                },
            },
            { key: 'alt', label: t('toolbar.imageDialogAlt'), value: alt, placeholder: t('toolbar.imageDialogAltHint') },
        ],
    });
}

/**
 * 插入视频对话框（支持选本地文件）
 * @returns {Promise<{url:string}|null>}
 */
export function showVideoDialog({ url = '', currentDir = null } = {}) {
    return showInputDialog({
        title: t('toolbar.videoDialogTitle'),
        fields: [
            {
                key: 'url',
                label: t('toolbar.videoDialogUrl'),
                value: url,
                placeholder: 'https://',
                button: {
                    label: t('toolbar.dialogBrowse'),
                    onClick: async (setValue) => {
                        const picked = await pickLocalPath(currentDir, [
                            { name: t('toolbar.videoDialogFilter'), extensions: VIDEO_EXTENSIONS },
                        ]);
                        if (picked) setValue(picked);
                    },
                },
            },
        ],
    });
}
