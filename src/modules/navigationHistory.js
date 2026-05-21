/**
 * 文档导航历史（浏览器式后退 / 前进）
 *
 * 记录 Markdown 文档的访问序列，支持像浏览器一样后退、前进。
 * - record() 由 toolbarController 在文档切换时调用
 * - 后退 / 前进通过 open-file 事件复用既有的文档打开机制，不直接依赖 fileTree
 * - 后退 / 前进回到的文档不会被重复记入历史（靠 stack[index] 去重）
 */

const MAX_ENTRIES = 100;

function createNavigationHistory() {
    let stack = [];
    let index = -1;
    const listeners = new Set();

    function notify() {
        for (const fn of listeners) {
            try {
                fn();
            } catch (error) {
                console.error('[navigationHistory] listener 出错:', error);
            }
        }
    }

    function navigateTo(path) {
        window.dispatchEvent(new CustomEvent('open-file', { detail: { path } }));
    }

    return {
        /**
         * 记录一次文档访问。
         * 后退 / 前进回到的文档（与当前指针一致）不会重复记录；
         * 从历史中段发起新导航时，会截断 forward 部分。
         */
        record(path) {
            if (!path || path.startsWith('untitled://')) return;
            if (stack[index] === path) return;

            stack = stack.slice(0, index + 1);
            stack.push(path);
            if (stack.length > MAX_ENTRIES) {
                stack = stack.slice(stack.length - MAX_ENTRIES);
            }
            index = stack.length - 1;
            notify();
        },

        canGoBack() {
            return index > 0;
        },

        canGoForward() {
            return index < stack.length - 1;
        },

        goBack() {
            if (index <= 0) return;
            index -= 1;
            notify();
            navigateTo(stack[index]);
        },

        goForward() {
            if (index >= stack.length - 1) return;
            index += 1;
            notify();
            navigateTo(stack[index]);
        },

        /**
         * 订阅历史变化，返回取消订阅函数。
         */
        onChange(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
    };
}

export const navigationHistory = createNavigationHistory();
