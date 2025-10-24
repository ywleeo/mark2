/**
 * TodoList 组件 - 显示 AI 任务执行的 TODO 列表
 */
export class TodoList {
    constructor(container) {
        this.container = container;
        this.todos = [];
        this.render();
    }

    /**
     * 更新 TODO 列表
     * @param {Array} todos - TODO 数组
     */
    updateTodos(todos) {
        this.todos = todos;
        this.render();
    }

    /**
     * 更新单个 TODO 的状态
     * @param {string} todoId - TODO ID
     * @param {string} status - 状态 (pending/in_progress/completed/failed)
     * @param {string} output - 输出信息
     */
    updateTodoStatus(todoId, status, output) {
        const todo = this.todos.find(t => t.id === todoId);
        if (todo) {
            todo.status = status;
            if (output) {
                todo.output = output;
            }
            this.render();
        }
    }

    /**
     * 清空 TODO 列表
     */
    clear() {
        this.todos = [];
        this.render();
    }

    /**
     * 渲染 TODO 列表
     */
    render() {
        if (this.todos.length === 0) {
            this.container.innerHTML = '';
            this.container.style.display = 'none';
            return;
        }

        this.container.style.display = 'block';

        // 更新动画帧
        if (!this.animationFrame) {
            this.animationFrame = 0;
        }
        this.animationFrame = (this.animationFrame + 1) % 4;

        const html = `
            <div class="todo-list">
                ${this.todos.map((todo) => this.renderTodoItem(todo)).join('')}
            </div>
        `;

        this.container.innerHTML = html;

        // 如果有进行中的任务，继续动画
        if (this.todos.some(t => t.status === 'in_progress')) {
            if (this.animationTimer) {
                clearTimeout(this.animationTimer);
            }
            this.animationTimer = setTimeout(() => this.render(), 200);
        }
    }

    /**
     * 渲染单个 TODO 项
     */
    renderTodoItem(todo) {
        const bullet = this.getBullet(todo.status);

        // 操作类型标签
        const actionLabel = this.getActionLabel(todo.action.type);

        // 目标文件
        const target = todo.action?.target ? ` ${this.escapeHtml(todo.action.target)}` : '';

        // 输出内容（后端已经做了格式化和截断）
        let outputInfo = '';
        if (todo.output) {
            outputInfo = ` - ${this.escapeHtml(todo.output)}`;
        }

        return `<div class="todo-item todo-item--${todo.status}" data-todo-id="${todo.id}">
            ${bullet} [${actionLabel}]${target}${outputInfo}
        </div>`;
    }

    /**
     * 获取操作类型的中文标签
     */
    getActionLabel(actionType) {
        const labels = {
            read: '读取',
            write: '写入',
            replace: '替换',
            insert: '插入',
            think: '生成',
        };
        return labels[actionType] || actionType;
    }

    /**
     * 获取项目符号
     */
    getBullet(status) {
        const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        switch (status) {
            case 'pending':
                return '○';
            case 'in_progress':
                return frames[this.animationFrame % frames.length];
            case 'completed':
                return '<span style="color: #10b981;">●</span>';
            case 'failed':
                return '<span style="color: #ef4444;">●</span>';
            default:
                return '○';
        }
    }

    /**
     * 转义 HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
