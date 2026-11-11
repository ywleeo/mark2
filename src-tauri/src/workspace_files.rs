//! 工作区目录发现入口，独立于文稿读取、保存及通用目录服务。

use crate::file_exclusions::{FileExclusionSettings, FileExclusions};
use crate::fs_commands::{read_dir, DirEntryInfo};
use std::path::Path;

/// 在读取子目录前检查其祖先，根目录始终可见；所有条目使用同一规则快照。
#[tauri::command]
pub fn list_workspace_directory(
    path: String,
    root_path: String,
    exclusions: FileExclusionSettings,
) -> Result<Vec<DirEntryInfo>, String> {
    let root = Path::new(&root_path);
    let directory = Path::new(&path);
    if !directory.starts_with(root) {
        return Err("Directory is outside workspace root".into());
    }
    let matcher = FileExclusions::compile(&exclusions)
        .map_err(|errors| format!("Invalid exclusion rules: {errors:?}"))?;
    if matcher.excludes_path(directory, root, true) {
        return Ok(Vec::new());
    }
    Ok(read_dir(path)?
        .into_iter()
        .filter(|entry| !matcher.excludes_path(Path::new(&entry.path), root, entry.is_dir))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// 在真实文件系统验证目录读取与通用文件服务边界，兼容 Unix 和 Windows。
    #[test]
    fn filters_discovery_without_changing_generic_directory_reads() {
        let root = std::env::temp_dir().join(format!("mark2-exclusions-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join(".git/objects")).unwrap();
        fs::write(root.join(".gitignore"), "*").unwrap();
        fs::write(root.join(".env"), "visible").unwrap();
        fs::write(root.join("note.md"), "visible").unwrap();
        let config = || crate::file_exclusions::tests::settings(&[".git", ".gitignore"]);
        let path = root.to_string_lossy().into_owned();
        let listed = list_workspace_directory(path.clone(), path.clone(), config()).unwrap();
        assert_eq!(listed.len(), 2);
        assert!(listed.iter().any(|entry| entry.name == ".env"));
        assert_eq!(read_dir(path.clone()).unwrap().len(), 4);
        assert!(list_workspace_directory(
            root.join(".git/objects").to_string_lossy().into_owned(),
            path.clone(),
            config()
        )
        .unwrap()
        .is_empty());
        assert!(list_workspace_directory(
            path.clone(),
            path,
            crate::file_exclusions::tests::settings(&["*"])
        )
        .unwrap()
        .is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}
