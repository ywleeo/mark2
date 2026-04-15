import { createStore } from '../../services/storage.js';

const store = createStore('cardExport');
store.migrateFrom('cardSidebarWidth', 'sidebarWidth', { parse: (raw) => Number(raw) });
store.migrateFrom('cardSidebarVisible', 'sidebarVisible', { parse: (raw) => raw === '1' });

const WIDTH_RANGE = {
    MIN: 320,
    MAX: 520,
};

function clampWidth(value) {
    return Math.max(WIDTH_RANGE.MIN, Math.min(WIDTH_RANGE.MAX, value));
}

export function createCardSidebarLayoutService() {
    let width = clampWidth(Number(store.get('sidebarWidth', 420)) || 420);
    let visible = Boolean(store.get('sidebarVisible', false));
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
        store.set('sidebarWidth', next);
        notify();
    }

    function show() {
        if (visible) {
            return;
        }
        visible = true;
        store.set('sidebarVisible', true);
        notify();
    }

    function hide() {
        if (!visible) {
            return;
        }
        visible = false;
        store.set('sidebarVisible', false);
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
