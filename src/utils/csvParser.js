/**
 * CSV 解析工具
 * 将 CSV 文本解析为与 SpreadsheetViewer 兼容的数据格式
 */

/**
 * 简单的 CSV 解析器
 * 支持：
 * - 逗号分隔
 * - 引号包裹的字段（可包含逗号和换行）
 * - 双引号转义
 */
function parseCSV(text) {
    if (typeof text !== 'string') {
        return [];
    }

    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (inQuotes) {
            if (char === '"') {
                if (nextChar === '"') {
                    // 双引号转义
                    currentField += '"';
                    i++; // 跳过下一个引号
                } else {
                    // 引号结束
                    inQuotes = false;
                }
            } else {
                currentField += char;
            }
        } else {
            if (char === '"') {
                // 引号开始
                inQuotes = true;
            } else if (char === ',') {
                // 字段分隔符
                currentRow.push(currentField);
                currentField = '';
            } else if (char === '\n') {
                // 行结束
                currentRow.push(currentField);
                if (currentRow.length > 0 && !(currentRow.length === 1 && currentRow[0] === '')) {
                    rows.push(currentRow);
                }
                currentRow = [];
                currentField = '';
            } else if (char === '\r') {
                // 忽略 \r（会在 \r\n 的情况下被处理）
                if (nextChar !== '\n') {
                    // 单独的 \r 也视为行结束
                    currentRow.push(currentField);
                    if (currentRow.length > 0 && !(currentRow.length === 1 && currentRow[0] === '')) {
                        rows.push(currentRow);
                    }
                    currentRow = [];
                    currentField = '';
                }
            } else {
                currentField += char;
            }
        }
    }

    // 处理最后一个字段和行
    if (currentField || currentRow.length > 0) {
        currentRow.push(currentField);
        if (currentRow.length > 0 && !(currentRow.length === 1 && currentRow[0] === '')) {
            rows.push(currentRow);
        }
    }

    return rows;
}

/**
 * 将 CSV 行数组转换回 CSV 文本
 */
export function stringifyCSV(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return '';
    }

    return rows.map(row => {
        if (!Array.isArray(row)) {
            return '';
        }
        return row.map(cell => {
            const value = String(cell || '');
            // 如果包含逗号、引号或换行，需要用引号包裹
            if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
                // 转义引号
                const escaped = value.replace(/"/g, '""');
                return `"${escaped}"`;
            }
            return value;
        }).join(',');
    }).join('\n');
}

/**
 * 将 CSV 文本解析为 SpreadsheetViewer 需要的格式
 * @param {string} csvText - CSV 文本内容
 * @param {string} fileName - 文件名（用作 sheet 名称）
 * @returns {{ sheets: Array<{ name: string, rows: Array<Array<string>> }> }}
 */
export function parseCsvToSpreadsheetData(csvText, fileName = 'Sheet1') {
    const rows = parseCSV(csvText);

    // 提取不带扩展名的文件名作为 sheet 名称
    const sheetName = fileName.replace(/\.csv$/i, '') || 'Sheet1';

    return {
        sheets: [
            {
                name: sheetName,
                rows: rows
            }
        ]
    };
}

/**
 * 将 SpreadsheetData 格式转换回 CSV 文本
 * @param {{ sheets: Array<{ name: string, rows: Array<Array<string>> }> }} spreadsheetData
 * @returns {string} CSV 文本
 */
export function spreadsheetDataToCsv(spreadsheetData) {
    if (!spreadsheetData || !Array.isArray(spreadsheetData.sheets) || spreadsheetData.sheets.length === 0) {
        return '';
    }

    // 只使用第一个 sheet（CSV 文件不支持多 sheet）
    const firstSheet = spreadsheetData.sheets[0];
    if (!firstSheet || !Array.isArray(firstSheet.rows)) {
        return '';
    }

    return stringifyCSV(firstSheet.rows);
}
