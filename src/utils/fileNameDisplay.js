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

export function refreshCompactFileNameElements(root = document) {
    if (!root) return;

    if (root instanceof Element && root.matches('.tree-item-name[data-full-name], .open-file-name[data-full-name]')) {
        refreshCompactFileNameElement(root);
    }

    const labels = root.querySelectorAll?.('.tree-item-name[data-full-name], .open-file-name[data-full-name]');
    if (!labels) return;
    labels.forEach((label) => refreshCompactFileNameElement(label));
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
    scheduleCompactFileNameRefresh(label);

    return label;
}
