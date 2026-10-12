/**
 * 按当前文档 tab 隔离文档目录（TOC）与 AI 文档任务侧栏的显隐状态。
 *
 * @param {object} options - 侧栏状态读写器与初始文档
 * @returns {{activate:(path:string|null)=>void,forget:(path:string)=>void,rename:(oldPath:string,newPath:string)=>void}}
 */
export function createTabSidebarStateController(options = {}) {
    const states = new Map();
    let activePath = options.initialPath || null;

    /** 读取当前窗口实际显示状态，避免与按钮切换不同步。 */
    const getCurrentState = (path = activePath) => ({
        tocOpen: Boolean(options.getTocSidebarOpen?.()),
        aiOpen: Boolean(options.getAiSidebarOpen?.(path)),
    });

    if (activePath) {
        states.set(activePath, getCurrentState(activePath));
    }

    /** 将指定文档的侧栏状态应用到当前窗口。 */
    function apply(path, state) {
        options.setTocSidebarOpen?.(path, state.tocOpen);
        options.setAiSidebarOpen?.(path, state.aiOpen);
    }

    return {
        /**
         * 在文档 tab 切换时保存旧状态并恢复目标状态；从未激活过的新 tab 默认关闭两栏。
         * @param {string|null} path - 新活动文档路径
         */
        activate(path) {
            const nextPath = path || null;
            if (nextPath === activePath) return;

            if (activePath && states.has(activePath)) {
                states.set(activePath, getCurrentState(activePath));
            }

            activePath = nextPath;
            if (!activePath) {
                apply(null, { tocOpen: false, aiOpen: false });
                return;
            }

            const state = states.get(activePath) || {
                tocOpen: false,
                aiOpen: false,
            };
            states.set(activePath, state);
            apply(activePath, state);
        },

        /**
         * 文档 tab 关闭后丢弃其 UI 状态，避免日后重新打开时继承旧 tab 的侧栏状态。
         * @param {string} path - 已关闭文档路径
         */
        forget(path) {
            if (path) states.delete(path);
        },

        /**
         * 重命名不会创建新 tab，因此迁移旧路径状态并在活动文档上立即恢复。
         * @param {string} oldPath - 重命名前的路径
         * @param {string} newPath - 重命名后的路径
         */
        rename(oldPath, newPath) {
            if (!oldPath || !newPath || oldPath === newPath) return;
            const previousState = states.get(oldPath);
            states.delete(oldPath);
            if (!previousState) return;
            states.set(newPath, previousState);
            if (activePath === newPath) apply(newPath, previousState);
        },
    };
}
