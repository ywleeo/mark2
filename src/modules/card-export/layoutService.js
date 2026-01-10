const STORAGE_KEYS = {
    WIDTH: 'cardSidebarWidth',
    VISIBLE: 'cardSidebarVisible',
};

const WIDTH_RANGE = {
    MIN: 320,
    MAX: 520,
};

function clampWidth(value) {
    return Math.max(WIDTH_RANGE.MIN, Math.min(WIDTH_RANGE.MAX, value));
}

function loadNumber(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) {
            return fallback;
        }
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : fallback;
    } catch (error) {
        console.warn('[CardSidebar] 无法读取存储的宽度', error);
        return fallback;
    }
}

function loadBoolean(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null || raw === undefined) {
            return fallback;
        }
        return raw === '1';
    } catch (error) {
        console.warn('[CardSidebar] 无法读取可见性', error);
        return fallback;
    }
}

function persist(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (error) {
        console.warn('[CardSidebar] 无法保存设置', error);
    }
}

export function createCardSidebarLayoutService() {
    let width = clampWidth(loadNumber(STORAGE_KEYS.WIDTH, 420));
    let visible = loadBoolean(STORAGE_KEYS.VISIBLE, false);
    let listeners = [];

    function updateDOM() {
        if (visible) {
            document.body.classList.add('card-sidebar-visible');
        } else {
            document.body.classList.remove('card-sidebar-visible');
        }
        document.documentElement.style.setProperty('--card-sidebar-width', `${width}px`);
    }

    function notify() {
        updateDOM();
        listeners.forEach(listener => {
            try {
                listener({ width, visible });
            } catch (error) {
                console.warn('[CardSidebar] layout listener failed', error);
            }
        });
    }

    function setWidth(value) {
        const next = clampWidth(value);
        if (next === width) {
            return;
        }
        width = next;
        persist(STORAGE_KEYS.WIDTH, String(next));
        notify();
    }

    function show() {
        if (visible) {
            return;
        }
        visible = true;
        persist(STORAGE_KEYS.VISIBLE, '1');
        notify();
    }

    function hide() {
        if (!visible) {
            return;
        }
        visible = false;
        persist(STORAGE_KEYS.VISIBLE, '0');
        notify();
    }

    function toggle() {
        if (visible) {
            hide();
        } else {
            show();
        }
    }

    function subscribe(listener) {
        listeners.push(listener);
        updateDOM();
        listener({ width, visible });
        return () => {
            listeners = listeners.filter(l => l !== listener);
        };
    }

    updateDOM();

    return {
        setWidth,
        show,
        hide,
        toggle,
        getState: () => ({ width, visible }),
        subscribe,
        WIDTH_RANGE,
    };
}
