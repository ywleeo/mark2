/**
 * AI Agent 文件读取工具 - 支持多种格式的 info 查询和分块读取
 *
 * 支持格式：
 * - 纯文本 / CSV：按行分块
 * - Excel (.xls/.xlsx 等)：按 sheet + 行范围
 * - DOCX：按段落范围
 * - PPTX：按幻灯片范围
 * - PDF：按页码范围
 */

import mammoth from 'mammoth';
import JSZip from 'jszip';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { readFile, readBinaryBase64, readSpreadsheet } from '../../api/filesystem.js';
import { stringifyCSV } from '../../utils/csvParser.js';

if (pdfWorkerSrc && GlobalWorkerOptions.workerSrc !== pdfWorkerSrc) {
    GlobalWorkerOptions.workerSrc = pdfWorkerSrc;
}

// ── 通用工具 ─────────────────────────────────────────────────────

function getExt(path) {
    return path.split('.').pop().toLowerCase();
}

function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

function sizeKb(base64) {
    return Math.round(base64.length * 0.75 / 1024);
}

function splitLines(content) {
    return content.endsWith('\n') ? content.slice(0, -1).split('\n') : content.split('\n');
}

// ── 纯文本 / CSV ──────────────────────────────────────────────────

const SPREADSHEET_EXTS = new Set(['xls', 'xlsx', 'xlsm', 'xlt', 'xltx', 'xltm']);

async function getTextFileInfo(path) {
    const content = await readFile(path);
    const lines = splitLines(content);
    return {
        type: getExt(path),
        size_kb: Math.round(content.length / 1024),
        line_count: lines.length,
        chunk_unit: 'line',
    };
}

async function readTextChunk(path, start, end) {
    const content = await readFile(path);
    const lines = splitLines(content);
    const s = Math.max(1, start);
    const e = Math.min(lines.length, end);
    if (s > lines.length) return { error: `起始行 ${s} 超出总行数 ${lines.length}` };
    return {
        content: lines.slice(s - 1, e).map((l, i) => `${s + i}: ${l}`).join('\n'),
        start_line: s,
        end_line: e,
        total_lines: lines.length,
    };
}

// ── Excel / XLS / XLSX ────────────────────────────────────────────

async function getSpreadsheetInfo(path) {
    const data = await readSpreadsheet(path);
    const sheets = data?.sheets ?? [];
    return {
        type: getExt(path),
        sheets: sheets.map(s => s.name),
        row_counts: sheets.map(s => s.rows?.length ?? 0),
        chunk_unit: 'row（需配合 sheet 参数）',
    };
}

async function readSpreadsheetChunk(path, start, end, sheet) {
    const data = await readSpreadsheet(path);
    const sheets = data?.sheets ?? [];
    if (sheets.length === 0) return { error: '该文件没有工作表' };

    let target = sheets[0];
    if (sheet) {
        const found = sheets.find(s => s.name === sheet);
        if (!found) {
            return { error: `找不到工作表 "${sheet}"，可用: ${sheets.map(s => s.name).join(', ')}` };
        }
        target = found;
    }

    const rows = target.rows ?? [];
    const s = Math.max(1, start);
    const e = Math.min(rows.length, end);
    if (s > rows.length) return { error: `起始行 ${s} 超出工作表总行数 ${rows.length}` };

    return {
        content: stringifyCSV(rows.slice(s - 1, e)),
        sheet: target.name,
        start_row: s,
        end_row: e,
        total_rows: rows.length,
    };
}

// ── DOCX ─────────────────────────────────────────────────────────

async function getDocxInfo(path) {
    const base64 = await readBinaryBase64(path);
    const result = await mammoth.extractRawText({ arrayBuffer: base64ToArrayBuffer(base64) });
    const paragraphs = result.value.split('\n').filter(p => p.trim().length > 0);
    return {
        type: 'docx',
        size_kb: sizeKb(base64),
        paragraph_count: paragraphs.length,
        chunk_unit: 'paragraph',
    };
}

async function readDocxChunk(path, start, end) {
    const base64 = await readBinaryBase64(path);
    const result = await mammoth.extractRawText({ arrayBuffer: base64ToArrayBuffer(base64) });
    const paragraphs = result.value.split('\n').filter(p => p.trim().length > 0);
    const s = Math.max(1, start);
    const e = Math.min(paragraphs.length, end);
    if (s > paragraphs.length) return { error: `起始段落 ${s} 超出总段落数 ${paragraphs.length}` };
    return {
        content: paragraphs.slice(s - 1, e).join('\n\n'),
        start_paragraph: s,
        end_paragraph: e,
        total_paragraphs: paragraphs.length,
    };
}

// ── PPTX ─────────────────────────────────────────────────────────
// （XML 解析逻辑与 fileRenderers/handlers/pptx.js 一致）

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function getTags(parent, ns, localName) {
    return Array.from(parent.getElementsByTagNameNS(ns, localName));
}

function parseSlide(xmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, 'text/xml');
    let title = '';
    const bodyItems = [];

    for (const sp of getTags(doc, NS_P, 'sp')) {
        const txBody = getTags(sp, NS_P, 'txBody')[0];
        if (!txBody) continue;
        const items = getTags(txBody, NS_A, 'p')
            .map(p => {
                const text = getTags(p, NS_A, 't').map(t => t.textContent).join('').trim();
                const pPr = getTags(p, NS_A, 'pPr')[0];
                const lvl = pPr ? Math.max(0, parseInt(pPr.getAttribute('lvl') || '0', 10)) : 0;
                return { text, level: lvl };
            })
            .filter(({ text }) => text.length > 0);
        if (items.length === 0) continue;

        const ph = getTags(sp, NS_P, 'ph')[0];
        const phType = ph?.getAttribute('type');
        if (phType === 'title' || phType === 'ctrTitle') {
            title = items.map(i => i.text).join(' ');
        } else {
            bodyItems.push(...items);
        }
    }
    return { title, bodyItems };
}

async function loadPptxSlides(path) {
    const base64 = await readBinaryBase64(path);
    const zip = await JSZip.loadAsync(base64ToArrayBuffer(base64));

    // 尝试从 relationship 文件获取幻灯片顺序
    let slidePaths = null;
    const relsFile = zip.files['ppt/_rels/presentation.xml.rels'];
    if (relsFile) {
        const relsXml = await relsFile.async('string');
        const relsDoc = new DOMParser().parseFromString(relsXml, 'text/xml');
        const slideRels = Array.from(relsDoc.getElementsByTagNameNS(
            'http://schemas.openxmlformats.org/package/2006/relationships', 'Relationship'
        )).filter(r =>
            r.getAttribute('Type')?.includes('/slide') &&
            !r.getAttribute('Type')?.includes('/slideLayout') &&
            !r.getAttribute('Type')?.includes('/slideMaster')
        );
        const presFile = zip.files['ppt/presentation.xml'];
        if (slideRels.length > 0 && presFile) {
            const presXml = await presFile.async('string');
            const presDoc = new DOMParser().parseFromString(presXml, 'text/xml');
            const relMap = new Map(slideRels.map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
            slidePaths = Array.from(presDoc.getElementsByTagNameNS(NS_P, 'sldId'))
                .map(sldId => {
                    const target = relMap.get(sldId.getAttributeNS(NS_R, 'id'));
                    return target ? `ppt/${target}` : null;
                })
                .filter(Boolean);
        }
    }

    if (!slidePaths || slidePaths.length === 0) {
        slidePaths = Object.keys(zip.files)
            .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
            .sort((a, b) => {
                const n = s => parseInt(s.match(/\d+/)?.[0] || '0', 10);
                return n(a) - n(b);
            });
    }

    return { zip, slidePaths, base64 };
}

async function getPptxInfo(path) {
    const { slidePaths, base64 } = await loadPptxSlides(path);
    return {
        type: 'pptx',
        size_kb: sizeKb(base64),
        slide_count: slidePaths.length,
        chunk_unit: 'slide',
    };
}

async function readPptxChunk(path, start, end) {
    const { zip, slidePaths } = await loadPptxSlides(path);
    const total = slidePaths.length;
    const s = Math.max(1, start);
    const e = Math.min(total, end);
    if (s > total) return { error: `起始幻灯片 ${s} 超出总数 ${total}` };

    const parts = [];
    for (let i = s; i <= e; i++) {
        const file = zip.files[slidePaths[i - 1]];
        if (!file) continue;
        const xml = await file.async('string');
        const { title, bodyItems } = parseSlide(xml);
        const lines = [`## ${title || `Slide ${i}`}`, ''];
        for (const { text, level } of bodyItems) lines.push(`${'  '.repeat(level)}- ${text}`);
        if (bodyItems.length > 0) lines.push('');
        parts.push(lines.join('\n'));
    }
    return {
        content: parts.join('\n'),
        start_slide: s,
        end_slide: e,
        total_slides: total,
    };
}

// ── PDF ──────────────────────────────────────────────────────────

async function getPdfInfo(path) {
    const base64 = await readBinaryBase64(path);
    const pdf = await getDocument({ data: base64ToArrayBuffer(base64) }).promise;
    return {
        type: 'pdf',
        size_kb: sizeKb(base64),
        page_count: pdf.numPages,
        chunk_unit: 'page',
    };
}

async function readPdfChunk(path, start, end) {
    const base64 = await readBinaryBase64(path);
    const pdf = await getDocument({ data: base64ToArrayBuffer(base64) }).promise;
    const total = pdf.numPages;
    const s = Math.max(1, start);
    const e = Math.min(total, end);
    if (s > total) return { error: `起始页 ${s} 超出总页数 ${total}` };

    const parts = [];
    for (let i = s; i <= e; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const text = textContent.items.map(item => item.str).join(' ').trim();
        if (text) parts.push(`[Page ${i}]\n${text}`);
    }
    return {
        content: parts.join('\n\n'),
        start_page: s,
        end_page: e,
        total_pages: total,
    };
}

// ── 公共接口 ─────────────────────────────────────────────────────

export async function getFileInfo(path) {
    const ext = getExt(path);
    if (SPREADSHEET_EXTS.has(ext)) return getSpreadsheetInfo(path);
    if (ext === 'docx') return getDocxInfo(path);
    if (ext === 'pptx') return getPptxInfo(path);
    if (ext === 'pdf') return getPdfInfo(path);
    return getTextFileInfo(path);   // csv / 纯文本 / 其他
}

export async function readFileChunk(path, start, end, sheet) {
    const ext = getExt(path);
    if (SPREADSHEET_EXTS.has(ext)) return readSpreadsheetChunk(path, start, end, sheet);
    if (ext === 'docx') return readDocxChunk(path, start, end);
    if (ext === 'pptx') return readPptxChunk(path, start, end);
    if (ext === 'pdf') return readPdfChunk(path, start, end);
    return readTextChunk(path, start, end);   // csv / 纯文本 / 其他
}
