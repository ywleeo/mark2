use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

const DEFAULT_MAX_RESULTS: usize = 500;
const DEFAULT_MAX_FILE_SIZE: u64 = 2 * 1024 * 1024;
const MAX_ALLOWED_RESULTS: usize = 5_000;
const MAX_ALLOWED_FILE_SIZE: u64 = 10 * 1024 * 1024;
const MATCH_CONTEXT_CHARACTERS: usize = 160;

/// 工作区搜索的可取消状态。每次新搜索都会让旧搜索尽快停止。
#[derive(Default)]
pub struct WorkspaceSearchState {
    generation: Arc<AtomicU64>,
}

/// 前端传入的工作区搜索参数。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchRequest {
    pub roots: Vec<String>,
    pub query: String,
    #[serde(default)]
    pub options: WorkspaceSearchOptions,
}

/// 搜索行为选项。限制由后端再次收敛，避免意外读取超大文件或返回无限结果。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchOptions {
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub whole_word: bool,
    #[serde(default)]
    pub use_regex: bool,
    #[serde(default = "default_max_results")]
    pub max_results: usize,
    #[serde(default = "default_max_file_size")]
    pub max_file_size: u64,
}

impl Default for WorkspaceSearchOptions {
    fn default() -> Self {
        Self {
            case_sensitive: false,
            whole_word: false,
            use_regex: false,
            max_results: DEFAULT_MAX_RESULTS,
            max_file_size: DEFAULT_MAX_FILE_SIZE,
        }
    }
}

/// 单个文本匹配，位置统一使用从 1 开始的字符行列，便于前端直接定位。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchMatch {
    pub root_path: String,
    pub file_path: String,
    pub relative_path: String,
    pub line_number: usize,
    pub column_number: usize,
    /// UTF-16 列号供 CodeMirror/JavaScript 精确定位，避免行首 emoji 造成偏移。
    pub utf16_column_number: usize,
    pub match_start: usize,
    pub match_end: usize,
    pub line_text: String,
}

/// 一次搜索的汇总结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchResponse {
    pub matches: Vec<WorkspaceSearchMatch>,
    pub truncated: bool,
    pub cancelled: bool,
    pub scanned_files: usize,
    pub skipped_files: usize,
}

impl WorkspaceSearchResponse {
    /// 创建空响应，供无搜索词和取消路径复用。
    fn empty() -> Self {
        Self {
            matches: Vec::new(),
            truncated: false,
            cancelled: false,
            scanned_files: 0,
            skipped_files: 0,
        }
    }
}

fn default_max_results() -> usize {
    DEFAULT_MAX_RESULTS
}

fn default_max_file_size() -> u64 {
    DEFAULT_MAX_FILE_SIZE
}

/// 递归遍历时跳过依赖、构建产物和版本库元数据，避免工作区搜索被噪声淹没。
fn should_skip_directory(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|name| name.to_str()),
        Some(".git" | ".svn" | ".hg" | "node_modules" | "target" | ".next" | ".cache")
    )
}

/// 判断字符是否属于“单词”。下划线按代码标识符习惯算作单词字符。
fn is_word_char(character: char) -> bool {
    character.is_alphanumeric() || character == '_'
}

/// 判断正则命中是否满足整词边界；按 Unicode 字符而不是字节判断。
fn is_whole_word(line: &str, start: usize, end: usize) -> bool {
    let before = line[..start].chars().next_back();
    let after = line[end..].chars().next();
    before.is_none_or(|character| !is_word_char(character))
        && after.is_none_or(|character| !is_word_char(character))
}

/// 编译用户查询。普通文本先转义，因此不会意外具有正则语义。
fn build_pattern(query: &str, options: &WorkspaceSearchOptions) -> Result<Regex, String> {
    let source = if options.use_regex {
        query.to_string()
    } else {
        regex::escape(query)
    };
    RegexBuilder::new(&source)
        .case_insensitive(!options.case_sensitive)
        .unicode(true)
        .build()
        .map_err(|error| format!("正则表达式无效：{error}"))
}

/// 粗略识别二进制文件。文本文件极少包含 NUL，抽样即可避免无意义解码。
fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8 * 1024).any(|byte| *byte == 0)
}

/// 计算相对路径；无法剥离根目录时退回文件名，保证 UI 始终有可展示名称。
fn relative_path(path: &Path, root: &Path) -> String {
    path.strip_prefix(root)
        .ok()
        .filter(|relative| !relative.as_os_str().is_empty())
        .or_else(|| path.file_name().map(Path::new))
        .unwrap_or(path)
        .to_string_lossy()
        .into_owned()
}

/// 限制单条结果携带的文本长度，避免超长单行在多次命中时放大 IPC 负担。
fn create_line_excerpt(line: &str, start: usize, end: usize) -> (String, usize, usize) {
    let characters: Vec<char> = line.chars().collect();
    let full_start = line[..start].chars().count();
    let full_end = full_start + line[start..end].chars().count();
    let slice_start = full_start.saturating_sub(MATCH_CONTEXT_CHARACTERS);
    let slice_end = (full_end + MATCH_CONTEXT_CHARACTERS).min(characters.len());
    let has_leading_ellipsis = slice_start > 0;
    let mut excerpt = String::new();
    if has_leading_ellipsis {
        excerpt.push('…');
    }
    excerpt.extend(characters[slice_start..slice_end].iter());
    if slice_end < characters.len() {
        excerpt.push('…');
    }
    let excerpt_start = full_start - slice_start + usize::from(has_leading_ellipsis);
    let excerpt_end = excerpt_start + (full_end - full_start);
    (excerpt, excerpt_start, excerpt_end)
}

/// 搜索单个 UTF-8 文本文件，并把命中追加到响应中。
fn search_file(
    path: &Path,
    root: &Path,
    pattern: &Regex,
    options: &WorkspaceSearchOptions,
    response: &mut WorkspaceSearchResponse,
) {
    let metadata = match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() && metadata.len() <= options.max_file_size => metadata,
        Ok(_) | Err(_) => {
            response.skipped_files += 1;
            return;
        }
    };
    if metadata.len() == 0 {
        response.scanned_files += 1;
        return;
    }

    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(_) => {
            response.skipped_files += 1;
            return;
        }
    };
    if looks_binary(&bytes) {
        response.skipped_files += 1;
        return;
    }
    let content = match std::str::from_utf8(&bytes) {
        Ok(content) => content,
        Err(_) => {
            response.skipped_files += 1;
            return;
        }
    };
    response.scanned_files += 1;

    let root_path = root.to_string_lossy().into_owned();
    let file_path = path.to_string_lossy().into_owned();
    let display_path = relative_path(path, root);

    for (line_index, line) in content.lines().enumerate() {
        for found in pattern.find_iter(line) {
            if options.whole_word && !is_whole_word(line, found.start(), found.end()) {
                continue;
            }
            let column_offset = line[..found.start()].chars().count();
            let utf16_column_offset = line[..found.start()].encode_utf16().count();
            let (line_text, match_start, match_end) =
                create_line_excerpt(line, found.start(), found.end());
            response.matches.push(WorkspaceSearchMatch {
                root_path: root_path.clone(),
                file_path: file_path.clone(),
                relative_path: display_path.clone(),
                line_number: line_index + 1,
                column_number: column_offset + 1,
                utf16_column_number: utf16_column_offset + 1,
                match_start,
                match_end,
                line_text,
            });
            if response.matches.len() >= options.max_results {
                response.truncated = true;
                return;
            }
        }
    }
}

/// 对一个根路径执行深度优先搜索，不跟随符号链接以避免目录环。
fn search_root(
    root: &Path,
    pattern: &Regex,
    options: &WorkspaceSearchOptions,
    response: &mut WorkspaceSearchResponse,
    generation: &AtomicU64,
    token: u64,
) {
    let mut pending = vec![root.to_path_buf()];
    while let Some(path) = pending.pop() {
        if generation.load(Ordering::Relaxed) != token || response.truncated {
            response.cancelled = generation.load(Ordering::Relaxed) != token;
            return;
        }

        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(_) => {
                response.skipped_files += 1;
                continue;
            }
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_file() {
            search_file(&path, root, pattern, options, response);
            continue;
        }
        if !metadata.is_dir() || (path != root && should_skip_directory(&path)) {
            continue;
        }

        let entries = match fs::read_dir(&path) {
            Ok(entries) => entries,
            Err(_) => {
                response.skipped_files += 1;
                continue;
            }
        };
        let mut children: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .collect();
        children.sort();
        children.reverse();
        pending.extend(children);
    }
}

/// 执行同步搜索；由 Tauri 命令放入阻塞线程池调用。
fn search_workspace_sync(
    request: WorkspaceSearchRequest,
    generation: Arc<AtomicU64>,
    token: u64,
) -> Result<WorkspaceSearchResponse, String> {
    let query = request.query.trim();
    if query.is_empty() {
        return Ok(WorkspaceSearchResponse::empty());
    }

    let mut options = request.options;
    options.max_results = options.max_results.clamp(1, MAX_ALLOWED_RESULTS);
    options.max_file_size = options
        .max_file_size
        .clamp(64 * 1024, MAX_ALLOWED_FILE_SIZE);
    let pattern = build_pattern(query, &options)?;
    let mut response = WorkspaceSearchResponse::empty();
    let mut seen_roots = HashSet::new();
    let mut roots: Vec<PathBuf> = request
        .roots
        .into_iter()
        .map(PathBuf::from)
        .map(|root| fs::canonicalize(&root).unwrap_or(root))
        .filter(|root| seen_roots.insert(root.clone()))
        .collect();
    roots.sort_by_key(|root| root.components().count());
    let mut independent_roots: Vec<PathBuf> = Vec::new();
    for root in roots {
        if independent_roots
            .iter()
            .any(|parent| root.starts_with(parent))
        {
            continue;
        }
        independent_roots.push(root);
    }

    for root in independent_roots {
        search_root(
            &root,
            &pattern,
            &options,
            &mut response,
            generation.as_ref(),
            token,
        );
        if response.cancelled || response.truncated {
            break;
        }
    }
    Ok(response)
}

/// 在后台线程搜索当前工作区；新请求会取消旧请求。
#[tauri::command]
pub async fn search_workspace(
    state: tauri::State<'_, WorkspaceSearchState>,
    request: WorkspaceSearchRequest,
) -> Result<WorkspaceSearchResponse, String> {
    let generation = Arc::clone(&state.generation);
    let token = generation.fetch_add(1, Ordering::Relaxed) + 1;
    tauri::async_runtime::spawn_blocking(move || search_workspace_sync(request, generation, token))
        .await
        .map_err(|error| format!("工作区搜索任务失败：{error}"))?
}

/// 显式取消当前搜索，供关闭搜索面板时释放后台工作。
#[tauri::command]
pub fn cancel_workspace_search(state: tauri::State<'_, WorkspaceSearchState>) {
    state.generation.fetch_add(1, Ordering::Relaxed);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// 创建本测试独占的临时目录。
    fn temp_root(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("mark2-workspace-search-{name}-{nonce}"));
        fs::create_dir_all(&root).expect("create temp root");
        root
    }

    /// 使用默认选项执行测试搜索。
    fn run(root: &Path, query: &str, options: WorkspaceSearchOptions) -> WorkspaceSearchResponse {
        let generation = Arc::new(AtomicU64::new(1));
        search_workspace_sync(
            WorkspaceSearchRequest {
                roots: vec![root.to_string_lossy().into_owned()],
                query: query.to_string(),
                options,
            },
            generation,
            1,
        )
        .expect("search succeeds")
    }

    #[test]
    fn finds_unicode_text_with_character_columns() {
        let root = temp_root("unicode");
        fs::write(root.join("note.md"), "标题\n你好 Mark2 世界\n").expect("write fixture");
        let response = run(&root, "Mark2", WorkspaceSearchOptions::default());
        assert_eq!(response.matches.len(), 1);
        assert_eq!(response.matches[0].line_number, 2);
        assert_eq!(response.matches[0].column_number, 4);
        assert_eq!(response.matches[0].utf16_column_number, 4);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reports_utf16_columns_for_javascript_editors() {
        let root = temp_root("utf16-column");
        fs::write(root.join("note.md"), "甲🙂 Mark2\n").expect("write fixture");
        let response = run(&root, "Mark2", WorkspaceSearchOptions::default());
        assert_eq!(response.matches[0].column_number, 4);
        assert_eq!(response.matches[0].utf16_column_number, 5);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn respects_case_and_whole_word_options() {
        let root = temp_root("options");
        fs::write(root.join("note.txt"), "mark mark2 MARK\n").expect("write fixture");
        let options = WorkspaceSearchOptions {
            case_sensitive: true,
            whole_word: true,
            ..WorkspaceSearchOptions::default()
        };
        let response = run(&root, "mark", options);
        assert_eq!(response.matches.len(), 1);
        assert_eq!(response.matches[0].column_number, 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn skips_binary_and_dependency_directories() {
        let root = temp_root("skip");
        fs::write(root.join("binary.bin"), b"needle\0payload").expect("write binary");
        fs::create_dir_all(root.join("node_modules/pkg")).expect("create dependency tree");
        fs::write(root.join("node_modules/pkg/index.js"), "needle").expect("write dependency");
        fs::write(root.join("visible.md"), "needle").expect("write text");
        let response = run(&root, "needle", WorkspaceSearchOptions::default());
        assert_eq!(response.matches.len(), 1);
        assert_eq!(response.matches[0].relative_path, "visible.md");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reports_invalid_regular_expression() {
        let root = temp_root("regex");
        let generation = Arc::new(AtomicU64::new(1));
        let result = search_workspace_sync(
            WorkspaceSearchRequest {
                roots: vec![root.to_string_lossy().into_owned()],
                query: "[".to_string(),
                options: WorkspaceSearchOptions {
                    use_regex: true,
                    ..WorkspaceSearchOptions::default()
                },
            },
            generation,
            1,
        );
        assert!(result.is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn truncates_very_long_result_lines_around_the_match() {
        let root = temp_root("long-line");
        let content = format!("{}needle{}", "a".repeat(2_000), "b".repeat(2_000));
        fs::write(root.join("long.txt"), content).expect("write fixture");
        let response = run(&root, "needle", WorkspaceSearchOptions::default());
        let found = &response.matches[0];
        assert!(found.line_text.chars().count() < 400);
        assert_eq!(found.column_number, 2_001);
        assert_eq!(
            found
                .line_text
                .chars()
                .skip(found.match_start)
                .take(found.match_end - found.match_start)
                .collect::<String>(),
            "needle"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn does_not_duplicate_results_for_nested_roots() {
        let root = temp_root("nested-roots");
        let nested = root.join("notes");
        fs::create_dir_all(&nested).expect("create nested root");
        fs::write(nested.join("note.md"), "needle").expect("write fixture");
        let generation = Arc::new(AtomicU64::new(1));
        let response = search_workspace_sync(
            WorkspaceSearchRequest {
                roots: vec![
                    nested.to_string_lossy().into_owned(),
                    root.to_string_lossy().into_owned(),
                ],
                query: "needle".to_string(),
                options: WorkspaceSearchOptions::default(),
            },
            generation,
            1,
        )
        .expect("search succeeds");
        assert_eq!(response.matches.len(), 1);
        let _ = fs::remove_dir_all(root);
    }
}
