import JSZip from 'jszip';

// OOXML namespaces
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

function getTags(parent, ns, localName) {
    return Array.from(parent.getElementsByTagNameNS(ns, localName));
}

// Extract plain text from a paragraph element <a:p>
function extractParaText(paraEl) {
    return getTags(paraEl, NS_A, 't')
        .map(t => t.textContent)
        .join('');
}

// Get bullet indent level from <a:pPr lvl="N">
function getIndentLevel(paraEl) {
    const pPr = getTags(paraEl, NS_A, 'pPr')[0];
    if (!pPr) return 0;
    const lvl = pPr.getAttribute('lvl');
    return lvl ? Math.max(0, parseInt(lvl, 10)) : 0;
}

// Check if a shape is a title placeholder
function isTitleShape(spEl) {
    const ph = getTags(spEl, NS_P, 'ph')[0];
    if (!ph) return false;
    const type = ph.getAttribute('type');
    return type === 'title' || type === 'ctrTitle';
}

// Parse a single slide XML → { title, bodyItems }
function parseSlide(xmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');

    let title = '';
    const bodyItems = [];

    for (const sp of getTags(doc, NS_P, 'sp')) {
        const txBody = getTags(sp, NS_P, 'txBody')[0];
        if (!txBody) continue;

        const items = getTags(txBody, NS_A, 'p')
            .map(p => ({ text: extractParaText(p).trim(), level: getIndentLevel(p) }))
            .filter(({ text }) => text.length > 0);

        if (items.length === 0) continue;

        if (isTitleShape(sp)) {
            title = items.map(i => i.text).join(' ');
        } else {
            bodyItems.push(...items);
        }
    }

    return { title, bodyItems };
}

// Get ordered slide paths from the relationship file
async function getSlideOrder(zip) {
    const relsPath = 'ppt/_rels/presentation.xml.rels';
    const relsFile = zip.files[relsPath];
    if (!relsFile) return null;

    const relsXml = await relsFile.async('string');
    const parser = new DOMParser();
    const doc = parser.parseFromString(relsXml, 'text/xml');

    const slideRels = Array.from(doc.getElementsByTagNameNS(
        'http://schemas.openxmlformats.org/package/2006/relationships',
        'Relationship'
    )).filter(rel =>
        rel.getAttribute('Type')?.includes('/slide') &&
        !rel.getAttribute('Type')?.includes('/slideLayout') &&
        !rel.getAttribute('Type')?.includes('/slideMaster')
    );

    if (slideRels.length === 0) return null;

    // Get ordered IDs from presentation.xml
    const presFile = zip.files['ppt/presentation.xml'];
    if (!presFile) return null;

    const presXml = await presFile.async('string');
    const presDoc = parser.parseFromString(presXml, 'text/xml');
    const sldIds = presDoc.getElementsByTagNameNS(NS_P, 'sldId');

    const relMap = new Map(slideRels.map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));

    return Array.from(sldIds)
        .map(sldId => {
            const rId = sldId.getAttributeNS(NS_R, 'id');
            const target = relMap.get(rId);
            return target ? `ppt/${target}` : null;
        })
        .filter(Boolean);
}

// Convert parsed slide data to Markdown section
function slideToMarkdown(slideNum, { title, bodyItems }) {
    const lines = [];
    lines.push(`## ${title || `Slide ${slideNum}`}`);
    lines.push('');

    for (const { text, level } of bodyItems) {
        lines.push(`${'  '.repeat(level)}- ${text}`);
    }

    if (bodyItems.length > 0) lines.push('');
    return lines.join('\n');
}

export function createPptxRenderer() {
    return {
        id: 'pptx',
        extensions: ['pptx'],
        getViewMode() {
            return 'pptx';
        },
        async load(ctx) {
            const { filePath, fileData, importAsUntitled } = ctx;
            const base64 = fileData?.content;
            if (!base64) return false;

            let zip;
            try {
                zip = await JSZip.loadAsync(base64ToArrayBuffer(base64));
            } catch {
                throw new Error('无法解析此文件，请确认它是有效的 .pptx 格式（不支持旧版 .ppt 格式）');
            }

            // Try to get ordered slide list from relationships; fall back to numeric sort
            let slidePaths = await getSlideOrder(zip);
            if (!slidePaths || slidePaths.length === 0) {
                slidePaths = Object.keys(zip.files)
                    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
                    .sort((a, b) => {
                        const n = s => parseInt(s.match(/\d+/)?.[0] || '0', 10);
                        return n(a) - n(b);
                    });
            }

            if (slidePaths.length === 0) {
                throw new Error('此文件不包含任何幻灯片内容');
            }

            const baseName = filePath.split(/[/\\]/).pop()?.replace(/\.pptx$/i, '') || 'Presentation';
            const mdParts = [`# ${baseName}`, ''];

            for (let i = 0; i < slidePaths.length; i++) {
                const file = zip.files[slidePaths[i]];
                if (!file) continue;
                const xml = await file.async('string');
                mdParts.push(slideToMarkdown(i + 1, parseSlide(xml)));
            }

            const markdown = mdParts.join('\n');
            const suggestedName = `${baseName}.md`;
            await importAsUntitled(markdown, suggestedName);
            return true;
        },
    };
}
