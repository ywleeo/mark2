use calamine::{open_workbook_auto, Data, Dimensions, Reader, Sheets};
use serde::Serialize;
use std::{fs::File, io::BufReader};

/// 一个工作表内的合并单元格区域，坐标相对于返回数据的左上角。
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpreadsheetMerge {
    pub start_row: u32,
    pub start_column: u32,
    pub end_row: u32,
    pub end_column: u32,
}

/// 传递给前端的单个工作表数据。
#[derive(Serialize)]
pub struct SpreadsheetSheet {
    pub name: String,
    pub rows: Vec<Vec<String>>,
    pub merges: Vec<SpreadsheetMerge>,
}

/// 传递给前端的完整工作簿数据。
#[derive(Serialize)]
pub struct SpreadsheetData {
    pub sheets: Vec<SpreadsheetSheet>,
}

/// 将 Calamine 单元格值转换为预览使用的纯文本。
fn data_type_to_string(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        _ => cell.to_string(),
    }
}

/// 从自动识别的工作簿读取指定工作表的合并区域。
fn read_merge_dimensions(
    workbook: &mut Sheets<BufReader<File>>,
    sheet_name: &str,
) -> Result<Vec<Dimensions>, String> {
    match workbook {
        Sheets::Xls(book) => book
            .merge_cells_by_sheet_name(sheet_name)
            .map_err(|error| error.to_string()),
        Sheets::Xlsx(book) => book
            .merge_cells_by_sheet_name(sheet_name)
            .map_err(|error| error.to_string()),
        Sheets::Xlsb(_) | Sheets::Ods(_) => Ok(Vec::new()),
    }
}

/// 将工作表绝对坐标转换成与 `Range::rows()` 二维数组一致的相对坐标。
fn normalize_merge_dimensions(
    dimensions: Vec<Dimensions>,
    range_start: (u32, u32),
) -> Vec<SpreadsheetMerge> {
    dimensions
        .into_iter()
        .filter_map(|dimension| {
            let start_row = dimension.start.0.checked_sub(range_start.0)?;
            let start_column = dimension.start.1.checked_sub(range_start.1)?;
            let end_row = dimension.end.0.checked_sub(range_start.0)?;
            let end_column = dimension.end.1.checked_sub(range_start.1)?;
            if start_row > end_row
                || start_column > end_column
                || (start_row == end_row && start_column == end_column)
            {
                return None;
            }
            Some(SpreadsheetMerge {
                start_row,
                start_column,
                end_row,
                end_column,
            })
        })
        .collect()
}

/// 读取电子表格的单元格文本和合并区域，供只读预览使用。
#[tauri::command]
pub fn read_spreadsheet(path: String) -> Result<SpreadsheetData, String> {
    let mut workbook = open_workbook_auto(&path).map_err(|e| e.to_string())?;
    let sheet_names = workbook.sheet_names().to_owned();

    if sheet_names.is_empty() {
        return Err("工作簿中没有可用的工作表".to_string());
    }

    let mut sheets = Vec::new();

    for sheet_name in sheet_names {
        match workbook.worksheet_range(&sheet_name) {
            Ok(range) => {
                let range_start = range.start().unwrap_or((0, 0));
                let rows = range
                    .rows()
                    .map(|row| row.iter().map(data_type_to_string).collect())
                    .collect();
                let merges = read_merge_dimensions(&mut workbook, &sheet_name)
                    .map(|dimensions| normalize_merge_dimensions(dimensions, range_start))
                    .unwrap_or_else(|error| {
                        eprintln!(
                            "读取工作表 {sheet_name} 的合并区域失败，将降级为普通单元格: {error}"
                        );
                        Vec::new()
                    });
                sheets.push(SpreadsheetSheet {
                    name: sheet_name,
                    rows,
                    merges,
                });
            }
            Err(err) => {
                return Err(format!("读取工作表 {} 失败: {}", sheet_name, err));
            }
        }
    }

    if sheets.is_empty() {
        return Err("未能从工作簿中读取任何数据".to_string());
    }

    Ok(SpreadsheetData { sheets })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 验证绝对合并坐标会按工作表数据起点转换为前端相对坐标。
    #[test]
    fn normalizes_merge_dimensions_against_range_start() {
        let dimensions = vec![Dimensions::new((4, 2), (5, 4))];

        assert_eq!(
            normalize_merge_dimensions(dimensions, (3, 1)),
            vec![SpreadsheetMerge {
                start_row: 1,
                start_column: 1,
                end_row: 2,
                end_column: 3,
            }]
        );
    }

    /// 验证无效、单格以及位于数据起点之前的区域不会进入前端协议。
    #[test]
    fn ignores_non_merge_and_out_of_range_dimensions() {
        let dimensions = vec![
            Dimensions::new((1, 1), (1, 1)),
            Dimensions::new((0, 0), (0, 2)),
        ];

        assert!(normalize_merge_dimensions(dimensions, (1, 1)).is_empty());
    }
}
