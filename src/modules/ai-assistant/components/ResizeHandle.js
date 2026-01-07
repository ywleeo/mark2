/**
 * Sidebar 宽度调节手柄
 */

export class ResizeHandle {
    constructor({ onResize }) {
        this.element = null;
        this.onResize = onResize;
        this.isDragging = false;
        this.startX = 0;
        this.startWidth = 0;

        this.handleMouseDown = this.handleMouseDown.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleMouseUp = this.handleMouseUp.bind(this);
    }

    render() {
        this.element = document.createElement('div');
        this.element.className = 'ai-sidebar-resize-handle';
        this.element.addEventListener('mousedown', this.handleMouseDown);
        return this.element;
    }

    handleMouseDown(e) {
        e.preventDefault();
        this.isDragging = true;
        this.startX = e.clientX;

        // 获取当前 sidebar 宽度
        const sidebar = this.element.parentElement;
        if (sidebar) {
            this.startWidth = sidebar.offsetWidth;
        }

        document.addEventListener('mousemove', this.handleMouseMove);
        document.addEventListener('mouseup', this.handleMouseUp);
        document.body.style.cursor = 'ew-resize';
        document.body.style.userSelect = 'none';
    }

    handleMouseMove(e) {
        if (!this.isDragging) {
            return;
        }

        const deltaX = this.startX - e.clientX; // 往左拖是正值（增加宽度）
        const newWidth = this.startWidth + deltaX;

        if (this.onResize) {
            this.onResize(newWidth);
        }
    }

    handleMouseUp() {
        if (!this.isDragging) {
            return;
        }

        this.isDragging = false;
        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('mouseup', this.handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    }

    destroy() {
        if (this.element) {
            this.element.removeEventListener('mousedown', this.handleMouseDown);
        }
        document.removeEventListener('mousemove', this.handleMouseMove);
        document.removeEventListener('mouseup', this.handleMouseUp);
        this.element = null;
    }
}
