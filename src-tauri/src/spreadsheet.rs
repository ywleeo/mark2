use calamine::{open_workbook_auto, Data, Reader};
use serde::Serialize;

#[derive(Serialize)]
pub struct SpreadsheetSheet {
    pub name: String,
    pub rows: Vec<Vec<String>>,
}

#[derive(Serialize)]
pub struct SpreadsheetData {
    pub sheets: Vec<SpreadsheetSheet>,
}

fn data_type_to_string(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        _ => cell.to_string(),
    }
}

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
                let rows = range
                    .rows()
                    .map(|row| row.iter().map(data_type_to_string).collect())
                    .collect();
                sheets.push(SpreadsheetSheet {
                    name: sheet_name,
                    rows,
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
