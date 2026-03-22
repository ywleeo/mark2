use serde::{Deserialize, Serialize};
use std::path::Path;

#[cfg(target_os = "macos")]
use objc2::rc::autoreleasepool;
#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSModalResponseOK, NSOpenPanel};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSString, NSURL};

#[cfg(target_os = "macos")]
use crate::macos_security::{
    create_bookmark_for_path, create_security_scoped_bookmark, start_access_from_bookmark, url_path,
};

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDialogOptions {
    pub directory: Option<bool>,
    pub multiple: Option<bool>,
    pub allow_directories: Option<bool>,
    pub allow_files: Option<bool>,
    pub default_path: Option<String>,
    pub title: Option<String>,
    pub message: Option<String>,
    pub prompt: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedPathEntry {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bookmark: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_directory: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityScopedBookmarkEntry {
    pub path: Option<String>,
    pub bookmark: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityScopeResult {
    pub requested_path: Option<String>,
    pub resolved_path: Option<String>,
    pub granted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub fn pick_path(
    _app: tauri::AppHandle,
    options: Option<FileDialogOptions>,
) -> Result<Vec<PickedPathEntry>, String> {
    #[cfg(target_os = "macos")]
    {
        use std::sync::mpsc;

        let opts = options.unwrap_or_default();
        let wants_directories = opts.directory.unwrap_or(false);
        let allow_directories = opts.allow_directories.unwrap_or(true);
        let allow_files = {
            let allow_files_opt = opts.allow_files.unwrap_or(!wants_directories);
            if !allow_directories && !allow_files_opt {
                true
            } else {
                allow_files_opt
            }
        };
        let allow_multiple = opts.multiple.unwrap_or(true);
        let treat_default_path_as_directory =
            wants_directories || (!allow_files && allow_directories);

        let default_path = opts.default_path.clone();
        let title = opts.title.clone();
        let message = opts.message.clone();
        let prompt = opts.prompt.clone();
        let (tx, rx) = mpsc::channel();
        _app.run_on_main_thread(move || {
            let picker_result = autoreleasepool(|_| {
                let mtm = MainThreadMarker::new().expect("pick_path must run on main thread");
                let panel = NSOpenPanel::openPanel(mtm);
                panel.setAllowsMultipleSelection(allow_multiple);
                panel.setCanChooseDirectories(allow_directories);
                panel.setCanChooseFiles(allow_files);
                panel.setCanCreateDirectories(true);

                if let Some(title_str) = title {
                    let ns_title = NSString::from_str(&title_str);
                    panel.setTitle(Some(&ns_title));
                }

                if let Some(message_str) = message {
                    let ns_message = NSString::from_str(&message_str);
                    panel.setMessage(Some(&ns_message));
                }

                if let Some(prompt_str) = prompt {
                    let ns_prompt = NSString::from_str(&prompt_str);
                    panel.setPrompt(Some(&ns_prompt));
                }

                if let Some(path_str) = default_path {
                    let path = Path::new(&path_str);
                    let directory_to_open = if treat_default_path_as_directory {
                        path
                    } else {
                        path.parent().unwrap_or(path)
                    };

                    if let Some(dir_str) = directory_to_open.to_str() {
                        let ns_parent = NSString::from_str(dir_str);
                        let parent_url = NSURL::fileURLWithPath(&ns_parent);
                        panel.setDirectoryURL(Some(&parent_url));
                    }

                    if !treat_default_path_as_directory {
                        if let Some(filename) = path.file_name() {
                            if let Some(filename_str) = filename.to_str() {
                                let ns_filename = NSString::from_str(filename_str);
                                panel.setNameFieldStringValue(&ns_filename);
                            }
                        }
                    }
                }

                if panel.runModal() != NSModalResponseOK {
                    return Ok(Vec::new());
                }

                let urls = panel.URLs();
                let mut entries = Vec::new();
                for idx in 0..urls.count() {
                    let url = urls.objectAtIndex(idx);
                    if let Some(path) = url_path(&url) {
                        let bookmark = create_security_scoped_bookmark(&url).ok();
                        let started = unsafe { url.startAccessingSecurityScopedResource() };
                        if !started {
                            eprintln!("failed to start security scoped resource for {}", path);
                        }
                        let is_directory = url.hasDirectoryPath();
                        entries.push(PickedPathEntry {
                            path,
                            bookmark,
                            is_directory: Some(is_directory),
                        });
                    }
                }

                Ok(entries)
            });

            let _ = tx.send(picker_result);
        })
        .map_err(|e| e.to_string())?;

        rx.recv().map_err(|e| e.to_string())?
    }

    #[cfg(not(target_os = "macos"))]
    {
        let opts = options.unwrap_or_default();
        let wants_directories = opts.directory.unwrap_or(false);
        let allow_directories = opts.allow_directories.unwrap_or(true);
        let allow_files = opts.allow_files.unwrap_or(!wants_directories);
        let use_folder_picker = wants_directories || (allow_directories && !allow_files);

        let default_title = if use_folder_picker {
            "Select Folder"
        } else {
            "Select File"
        };
        let mut dialog =
            rfd::FileDialog::new().set_title(opts.title.as_deref().unwrap_or(default_title));

        if let Some(ref default_path) = opts.default_path {
            let p = std::path::Path::new(default_path);
            if p.is_dir() {
                dialog = dialog.set_directory(p);
            } else if let Some(parent) = p.parent() {
                dialog = dialog.set_directory(parent);
            }
        }

        let paths = if use_folder_picker {
            if opts.multiple.unwrap_or(false) {
                dialog.pick_folders().unwrap_or_default()
            } else {
                dialog.pick_folder().map(|p| vec![p]).unwrap_or_default()
            }
        } else if opts.multiple.unwrap_or(false) {
            dialog.pick_files().unwrap_or_default()
        } else {
            dialog.pick_file().map(|p| vec![p]).unwrap_or_default()
        };

        Ok(paths
            .into_iter()
            .filter_map(|p| {
                let is_dir = p.is_dir();
                p.to_str().map(|s| PickedPathEntry {
                    path: s.to_string(),
                    bookmark: None,
                    is_directory: Some(is_dir),
                })
            })
            .collect())
    }
}

#[tauri::command]
pub fn restore_security_scoped_access(
    entries: Vec<SecurityScopedBookmarkEntry>,
) -> Result<Vec<SecurityScopeResult>, String> {
    #[cfg(target_os = "macos")]
    {
        let mut results = Vec::new();
        for entry in entries {
            match start_access_from_bookmark(&entry.bookmark) {
                Ok(resolved_path) => results.push(SecurityScopeResult {
                    requested_path: entry.path,
                    resolved_path: Some(resolved_path),
                    granted: true,
                    error: None,
                }),
                Err(err) => results.push(SecurityScopeResult {
                    requested_path: entry.path,
                    resolved_path: None,
                    granted: false,
                    error: Some(err),
                }),
            }
        }

        Ok(results)
    }

    #[cfg(not(target_os = "macos"))]
    {
        Ok(entries
            .into_iter()
            .map(|entry| SecurityScopeResult {
                requested_path: entry.path.clone(),
                resolved_path: entry.path,
                granted: true,
                error: None,
            })
            .collect())
    }
}

#[tauri::command]
pub fn capture_security_scope(path: String) -> Result<PickedPathEntry, String> {
    #[cfg(target_os = "macos")]
    {
        let (bookmark, is_directory) = create_bookmark_for_path(&path)?;
        Ok(PickedPathEntry {
            path,
            bookmark: Some(bookmark),
            is_directory: Some(is_directory),
        })
    }

    #[cfg(not(target_os = "macos"))]
    {
        let is_dir = Path::new(&path).is_dir();
        Ok(PickedPathEntry {
            path,
            bookmark: None,
            is_directory: Some(is_dir),
        })
    }
}
