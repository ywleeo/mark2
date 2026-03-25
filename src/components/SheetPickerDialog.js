/**
 * Sheet 选择弹窗
 * 用于从多 Sheet 的 Excel 文件中选择要导入的 Sheet
 */
export function showSheetPickerDialog(sheets) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'sheet-picker-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'sheet-picker-dialog';
        dialog.innerHTML = `
            <div class="sheet-picker-dialog__title">选择要导入的 Sheet</div>
            <div class="sheet-picker-dialog__list"></div>
            <div class="sheet-picker-dialog__actions">
                <button type="button" class="sheet-picker-dialog__cancel">取消</button>
            </div>
        `;

        const list = dialog.querySelector('.sheet-picker-dialog__list');
        sheets.forEach((sheet, index) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'sheet-picker-dialog__sheet-btn';
            btn.textContent = sheet.name || `Sheet ${index + 1}`;
            btn.addEventListener('click', () => {
                cleanup();
                resolve(index);
            });
            list.appendChild(btn);
        });

        dialog.querySelector('.sheet-picker-dialog__cancel').addEventListener('click', () => {
            cleanup();
            resolve(null);
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                cleanup();
                resolve(null);
            }
        });

        document.addEventListener('keydown', onKeydown);
        function onKeydown(e) {
            if (e.key === 'Escape') {
                cleanup();
                resolve(null);
            }
        }

        function cleanup() {
            document.removeEventListener('keydown', onKeydown);
            overlay.remove();
        }

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        // 聚焦第一个 sheet 按钮
        list.querySelector('.sheet-picker-dialog__sheet-btn')?.focus();
    });
}
