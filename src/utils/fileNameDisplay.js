const VISIBLE_NAME_CHARS_BEFORE_EXTENSION = 3;
const MIN_VISIBLE_HEAD_LENGTH = 1;
const ELLIPSIS = '...';

let measureContext = null;

function getMeasureContext() {
    if (measureContext) {
        return measureContext;
    }
    const canvas = document.createElement('canvas');
    measureContext = canvas.getContext('2d');
    return measureContext;
}

function getLabelFont(label) {
    const style = window.getComputedStyle(label);
    return [
        style.fontStyle,
        style.fontVariant,
        style.fontWeight,
        style.fontSize,
        style.fontFamily,
    ].join(' ');
}

function measureTextWidth(label, text) {
    if (!text) return 0;
    const context = getMeasureContext();
    if (!context) return text.length * 8;
    context.font = getLabelFont(label);
    return context.measureText(text).width;
}

function getPreferredSuffixText(fileName) {
    const lastDotIndex = fileName.lastIndexOf('.');
    if (lastDotIndex <= 0) {
        return fileName.slice(-VISIBLE_NAME_CHARS_BEFORE_EXTENSION);
    }

    const extension = fileName.slice(lastDotIndex);
    const stem = fileName.slice(0, lastDotIndex);
    const visibleStem = stem.slice(-VISIBLE_NAME_CHARS_BEFORE_EXTENSION);
    return `${visibleStem}${extension}`;
}

function findPrefixLengthThatFits(label, fileName, availableWidth, maxPrefixLength) {
    if (availableWidth <= 0 || maxPrefixLength <= 0) {
        return 0;
    }

    let low = 0;
    let high = maxPrefixLength;
    let best = 0;

    while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const width = measureTextWidth(label, fileName.slice(0, mid));
        if (width <= availableWidth) {
            best = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return best;
}

function buildCompactParts(label, fileName, availableWidth) {
    const fullWidth = measureTextWidth(label, fileName);
    if (!fileName || availableWidth <= 0 || fullWidth <= availableWidth) {
        return {
            prefix: fileName,
            suffix: '',
            truncated: false,
        };
    }

    const ellipsisWidth = measureTextWidth(label, ELLIPSIS);
    const suffix = getPreferredSuffixText(fileName);
    const suffixWidth = measureTextWidth(label, suffix);
    const availableForPrefix = availableWidth - ellipsisWidth - suffixWidth;
    const maxPrefixLength = Math.max(
        MIN_VISIBLE_HEAD_LENGTH,
        fileName.length - suffix.length - 1,
    );
    const prefixLength = findPrefixLengthThatFits(label, fileName, availableForPrefix, maxPrefixLength);

    return {
        prefix: fileName.slice(0, prefixLength),
        suffix,
        truncated: true,
    };
}

function buildCompactPartsFromFont(fontStr, fileName, availableWidth) {
    const ctx = getMeasureContext();
    if (ctx) ctx.font = fontStr;
    const measure = (text) => {
        if (!text) return 0;
        if (!ctx) return text.length * 8;
        return ctx.measureText(text).width;
    };

    const fullWidth = measure(fileName);
    if (!fileName || availableWidth <= 0 || fullWidth <= availableWidth) {
        return { prefix: fileName, suffix: '', truncated: false };
    }

    const ellipsisWidth = measure(ELLIPSIS);
    const suffix = getPreferredSuffixText(fileName);
    const suffixWidth = measure(suffix);
    const availableForPrefix = availableWidth - ellipsisWidth - suffixWidth;
    const maxPrefixLength = Math.max(
        MIN_VISIBLE_HEAD_LENGTH,
        fileName.length - suffix.length - 1,
    );

    let low = 0;
    let high = Math.min(maxPrefixLength, fileName.length);
    let best = 0;
    while (low <= high) {
        const mid = (low + high) >> 1;
        const width = measure(fileName.slice(0, mid));
        if (width <= availableForPrefix) {
            best = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return { prefix: fileName.slice(0, best), suffix, truncated: true };
}

export function refreshCompactFileNameElement(label) {
    if (!label) return;

    const fileName = label.dataset.fullName || '';
    const prefix = label.querySelector(`[data-role="prefix"]`);
    const ellipsis = label.querySelector(`[data-role="ellipsis"]`);
    const suffix = label.querySelector(`[data-role="suffix"]`);
    if (!prefix || !ellipsis || !suffix) return;

    const availableWidth = label.clientWidth || label.getBoundingClientRect().width || 0;
    const parts = buildCompactParts(label, fileName, availableWidth);

    prefix.textContent = parts.prefix;
    ellipsis.textContent = parts.truncated ? ELLIPSIS : '';
    suffix.textContent = parts.truncated ? parts.suffix : '';
    label.dataset.truncated = parts.truncated ? 'true' : 'false';
}

/**
 * 批量刷新文件名 label 的截断显示。
 * 关键：read-write 分离——先一次读完所有 label 的 font/宽度（layout 此时已就绪，
 * 不会重排），再纯 JS 计算 prefix，最后一口气写入 textContent。
 * 避免在 forEach 里读/写交错，触发 N 次 forced layout（层级目录展开 900+ 文件时
 * 旧实现会卡十几秒）。
 */
export function refreshCompactFileNameElements(root = document) {
    if (!root) return;

    const collectFromSingle = (el) => {
        const prefixEl = el.querySelector(`[data-role="prefix"]`);
        const ellipsisEl = el.querySelector(`[data-role="ellipsis"]`);
        const suffixEl = el.querySelector(`[data-role="suffix"]`);
        if (!prefixEl || !ellipsisEl || !suffixEl) return null;
        return {
            label: el,
            fileName: el.dataset.fullName || '',
            prefixEl,
            ellipsisEl,
            suffixEl,
        };
    };

    const items = [];
    if (root instanceof Element && root.matches('.tree-item-name[data-full-name], .open-file-name[data-full-name]')) {
        const item = collectFromSingle(root);
        if (item) items.push(item);
    }
    const nodeList = root.querySelectorAll?.('.tree-item-name[data-full-name], .open-file-name[data-full-name]');
    if (nodeList) {
        nodeList.forEach((el) => {
            const item = collectFromSingle(el);
            if (item) items.push(item);
        });
    }
    if (items.length === 0) return;

    // Phase 1: 集中读（font + clientWidth），不写 DOM
    for (const item of items) {
        item.fontStr = getLabelFont(item.label);
        item.availableWidth = item.label.clientWidth || item.label.getBoundingClientRect().width || 0;
    }

    // Phase 2: 纯 JS 计算（canvas measure 不引发 layout）
    for (const item of items) {
        item.parts = buildCompactPartsFromFont(item.fontStr, item.fileName, item.availableWidth);
    }

    // Phase 3: 集中写
    for (const item of items) {
        const { parts, prefixEl, ellipsisEl, suffixEl, label } = item;
        prefixEl.textContent = parts.prefix;
        ellipsisEl.textContent = parts.truncated ? ELLIPSIS : '';
        suffixEl.textContent = parts.truncated ? parts.suffix : '';
        label.dataset.truncated = parts.truncated ? 'true' : 'false';
    }
}

export function scheduleCompactFileNameRefresh(root = document) {
    window.requestAnimationFrame(() => {
        refreshCompactFileNameElements(root);
    });
}

export function createCompactFileNameElement(className, name) {
    const label = document.createElement('span');
    label.className = className;
    label.dataset.fullName = typeof name === 'string' ? name : '';
    label.title = label.dataset.fullName;

    const prefix = document.createElement('span');
    prefix.className = `${className}__prefix`;
    prefix.dataset.role = 'prefix';

    const ellipsis = document.createElement('span');
    ellipsis.className = `${className}__ellipsis`;
    ellipsis.dataset.role = 'ellipsis';

    const suffix = document.createElement('span');
    suffix.className = `${className}__suffix`;
    suffix.dataset.role = 'suffix';

    label.append(prefix, ellipsis, suffix);
    // 不再单独调度 rAF：调用方会在容器层面统一触发 scheduleCompactFileNameRefresh，
    // 避免 N 个 label 各自触发 forced reflow，造成 layout thrashing。
    return label;
}
