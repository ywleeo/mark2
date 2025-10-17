import { desktopDir, join } from '@tauri-apps/api/path';

export function formatTimestampForFilename(date) {
    const pad = (value) => String(value).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());
    return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

export async function buildDefaultScreenshotPath() {
    const timestamp = formatTimestampForFilename(new Date());
    const fileName = `Mark2-Screenshot-${timestamp}.png`;

    try {
        const desktop = await desktopDir();
        if (desktop && desktop.length > 0) {
            return await join(desktop, fileName);
        }
    } catch (error) {
        console.warn('无法获取桌面路径，使用默认文件名', error);
    }

    return fileName;
}

export async function buildDefaultPdfPath() {
    const timestamp = formatTimestampForFilename(new Date());
    const fileName = `Mark2-Export-${timestamp}.pdf`;

    try {
        const desktop = await desktopDir();
        if (desktop && desktop.length > 0) {
            return await join(desktop, fileName);
        }
    } catch (error) {
        console.warn('无法获取桌面路径，使用默认文件名', error);
    }

    return fileName;
}

export async function captureViewContent(ensureToPng) {
    const viewElement = document.getElementById('viewContent');
    if (!viewElement) {
        throw new Error('无法找到 viewContent 元素');
    }

    const captureElement = viewElement.querySelector('.tiptap-editor') || viewElement;

    const transparentValues = new Set(['rgba(0, 0, 0, 0)', 'transparent']);
    const getBackground = (element) => {
        const color = window.getComputedStyle(element).backgroundColor;
        return color && !transparentValues.has(color) ? color : null;
    };

    const bodyBackground = getBackground(document.body);
    const backgroundColor =
        getBackground(captureElement) ||
        getBackground(viewElement) ||
        bodyBackground ||
        '#ffffff';
    const scale = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3);

    const scrollWidth = Math.ceil(
        Math.max(
            captureElement.scrollWidth,
            captureElement.offsetWidth,
            captureElement.clientWidth
        )
    );
    const scrollHeight = Math.ceil(captureElement.scrollHeight);

    const wrapper = document.createElement('div');
    wrapper.style.position = 'fixed';
    wrapper.style.left = '-100000px';
    wrapper.style.top = '0';
    wrapper.style.padding = '0';
    wrapper.style.margin = '0';
    wrapper.style.background = backgroundColor;
    wrapper.style.width = `${scrollWidth}px`;
    wrapper.style.pointerEvents = 'none';
    wrapper.style.zIndex = '-1';

    captureElement
        .querySelectorAll('.screenshot-watermark')
        .forEach(element => element.remove());

    const clone = captureElement.cloneNode(true);
    clone.style.paddingBottom = '0px';
    clone.style.marginBottom = '0px';
    const watermarkElement = createWatermarkElement(backgroundColor || '#ffffff');
    clone.appendChild(watermarkElement);
    clone.style.width = `${scrollWidth}px`;
    clone.style.minHeight = `${scrollHeight}px`;
    clone.style.boxSizing = 'border-box';

    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);

    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(resolve));

    try {
        const targetWidth = Math.ceil(
            Math.max(
                scrollWidth,
                clone.scrollWidth,
                clone.offsetWidth,
                clone.clientWidth
            )
        );
        const targetHeight = Math.ceil(
            Math.max(
                scrollHeight,
                clone.scrollHeight,
                clone.offsetHeight,
                clone.clientHeight
            )
        );

        wrapper.style.width = `${targetWidth}px`;
        clone.style.width = `${targetWidth}px`;
        clone.style.minHeight = `${targetHeight}px`;

        await document.fonts?.ready;
        const renderToPng = await ensureToPng();
        const dataUrl = await renderToPng(clone, {
            backgroundColor,
            pixelRatio: scale,
            cacheBust: true,
            width: targetWidth,
            height: targetHeight,
            canvasWidth: Math.ceil(targetWidth * scale),
            canvasHeight: Math.ceil(targetHeight * scale),
        });
        return dataUrl;
    } finally {
        if (wrapper.parentNode) {
            wrapper.parentNode.removeChild(wrapper);
        }
    }
}

export async function collectContentForPdf(activeViewMode) {
    const viewElement = document.getElementById('viewContent');
    if (!viewElement) {
        throw new Error('无法找到 viewContent 元素');
    }

    let contentElement;
    if (activeViewMode === 'markdown') {
        contentElement = viewElement.querySelector('.tiptap-editor');
    } else {
        contentElement = viewElement.querySelector('.monaco-editor');
    }

    if (!contentElement) {
        contentElement = viewElement;
    }

    const htmlContent = contentElement.innerHTML;
    const cssContent = await collectAllStyles();
    const pageWidth = viewElement.clientWidth || 800;

    return { htmlContent, cssContent, pageWidth };
}

async function collectAllStyles() {
    const styles = [];

    const styleTags = document.querySelectorAll('style');
    styleTags.forEach(tag => {
        if (tag.textContent) {
            styles.push(tag.textContent);
        }
    });

    const linkTags = document.querySelectorAll('link[rel="stylesheet"]');
    for (const link of linkTags) {
        try {
            const href = link.getAttribute('href');
            if (href) {
                const response = await fetch(href);
                const cssText = await response.text();
                styles.push(cssText);
            }
        } catch (error) {
            console.warn('无法加载样式表:', link.href, error);
        }
    }

    styles.push(`
        body {
            margin: 0;
            padding: 20px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
            line-height: 1.6;
        }
        .tiptap-editor {
            max-width: 800px;
            margin: 0 auto;
        }
        .code-copy-button {
            display: none !important;
        }
    `);

    return styles.join('\\n');
}

function createWatermarkElement(baseBackground) {
    const container = document.createElement('div');
    container.className = 'screenshot-watermark';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.alignItems = 'center';
    container.style.padding = '2px 0 5px';
    container.style.background = baseBackground;

    const divider = document.createElement('div');
    divider.style.width = '100%';
    divider.style.height = '2px';
    divider.style.backgroundColor = '#eeeeee';
    divider.style.margin = '0 0 10px 0';

    const ribbon = document.createElement('span');
    ribbon.textContent = 'Mark2';
    ribbon.style.display = 'inline-block';
    ribbon.style.background = '#ff3b30';
    ribbon.style.color = '#ffffff';
    ribbon.style.fontSize = '14px';
    ribbon.style.fontWeight = '700';
    ribbon.style.padding = '2px 15px';
    ribbon.style.letterSpacing = '0.5px';

    container.appendChild(divider);
    container.appendChild(ribbon);

    return container;
}
