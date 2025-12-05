let mermaidPromise = null;
let mermaidInstance = null;
let initialized = false;

async function loadMermaid() {
    if (mermaidInstance) {
        return mermaidInstance;
    }
    if (!mermaidPromise) {
        mermaidPromise = import('mermaid')
            .then(module => {
                const mermaid = module?.default || module;
                if (!initialized) {
                    mermaid.initialize({
                        startOnLoad: false,
                        securityLevel: 'strict',
                    });
                    initialized = true;
                }
                mermaidInstance = mermaid;
                return mermaidInstance;
            })
            .catch(error => {
                mermaidPromise = null;
                throw error;
            });
    }
    return mermaidPromise;
}

const decodeMermaidCode = value => {
    if (!value) return '';
    try {
        return decodeURIComponent(value);
    } catch (_error) {
        return value;
    }
};

const encodeMermaidCode = value => {
    if (!value) return '';
    try {
        return encodeURIComponent(value);
    } catch (_error) {
        return value;
    }
};

export async function renderMermaidIn(rootElement) {
    if (typeof window === 'undefined' || !rootElement) {
        return;
    }

    const matchesMermaid = typeof rootElement.matches === 'function' && rootElement.matches('.mermaid');
    const fromRoot = matchesMermaid ? [rootElement] : [];
    const fromChildren = typeof rootElement.querySelectorAll === 'function'
        ? Array.from(rootElement.querySelectorAll('.mermaid'))
        : [];
    const candidates = [...fromRoot, ...fromChildren];

    const targets = candidates.filter(element => {
        const processed = element.getAttribute('data-processed');
        return processed !== 'true';
    });

    if (targets.length === 0) {
        return;
    }

    const mermaid = await loadMermaid();

    await Promise.all(targets.map(async element => {
        const encodedAttr = element.getAttribute('data-mermaid-code') || '';
        const existingCode = decodeMermaidCode(encodedAttr);
        const sourceNode = element.querySelector('.mermaid-source');
        const rawSource = sourceNode ? sourceNode.textContent : element.textContent || '';
        const raw = existingCode || rawSource;
        const code = raw ? raw.trim() : '';

        if (!code) {
            element.setAttribute('data-processed', 'true');
            return;
        }

        element.setAttribute('data-mermaid-code', encodeMermaidCode(code));

        try {
            element.classList.remove('mermaid--failed');
            const uniqueId =
                element.getAttribute('data-mermaid-id') ||
                `mermaid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            element.setAttribute('data-mermaid-id', uniqueId);
            const { svg } = await mermaid.render(uniqueId, code);
            element.innerHTML = svg;
            const svgElement = element.querySelector('svg');
            if (svgElement) {
                svgElement.removeAttribute('width');
                svgElement.removeAttribute('height');
                svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet');
                svgElement.style.overflow = 'visible';
                svgElement.style.display = 'block';
            }
            element.setAttribute('data-processed', 'true');
            element.classList.add('mermaid--clickable');
            element.setAttribute('title', '双击放大查看');
        } catch (error) {
            console.warn('[MermaidRenderer] 渲染失败', error);
            element.setAttribute('data-processed', 'true');
            element.classList.add('mermaid--failed');
            element.innerHTML = '';
            const fallback = document.createElement('pre');
            fallback.className = 'mermaid-fallback';
            fallback.textContent = code;
            element.appendChild(fallback);
        }
    }));
}
