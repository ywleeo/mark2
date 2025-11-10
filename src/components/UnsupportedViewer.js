export class UnsupportedViewer {
    constructor(containerElement) {
        this.container = containerElement;
        this.currentFile = null;
        this.filenameElement = null;
        this.errorElement = null;
        this.init();
    }

    init() {
        this.container.classList.add('unsupported-viewer');
        this.container.innerHTML = `
            <div class="unsupported-viewer-content">
                <div class="unsupported-viewer-title">无法预览该文件</div>
                <div class="unsupported-viewer-filename"></div>
                <div class="unsupported-viewer-description">
                    这是一个不支持编辑或预览的文件类型，请使用系统应用打开它。
                </div>
                <div class="unsupported-viewer-error"></div>
            </div>
        `;

        this.filenameElement = this.container.querySelector('.unsupported-viewer-filename');
        this.errorElement = this.container.querySelector('.unsupported-viewer-error');
    }

    show(filePath, error = null) {
        this.currentFile = filePath;
        const fileName = filePath?.split('/').pop() || filePath || '';
        if (this.filenameElement) {
            this.filenameElement.textContent = fileName;
        }

        if (this.errorElement) {
            const message = this.normalizeErrorMessage(error);
            if (message) {
                this.errorElement.textContent = `错误信息: ${message}`;
                this.errorElement.style.display = 'block';
            } else {
                this.errorElement.textContent = '';
                this.errorElement.style.display = 'none';
            }
        }

        this.container.style.display = 'flex';
    }

    normalizeErrorMessage(error) {
        if (!error) {
            return '';
        }
        if (typeof error === 'string') {
            return error;
        }
        if (error.message) {
            return error.message;
        }
        if (error.error) {
            return error.error;
        }
        return '';
    }

    clear() {
        this.currentFile = null;
        if (this.filenameElement) {
            this.filenameElement.textContent = '';
        }
        if (this.errorElement) {
            this.errorElement.textContent = '';
            this.errorElement.style.display = 'none';
        }
        this.container.style.display = 'none';
    }

    hide() {
        this.container.style.display = 'none';
    }

    dispose() {
        this.clear();
    }
}
