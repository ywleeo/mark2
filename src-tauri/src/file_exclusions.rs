//! 工作区展示与搜索共用的排除规则；通用文件系统操作不应用这些规则。

use glob::{MatchOptions, Pattern};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// 前端持久化的应用级配置快照，每次目录查询或搜索独立消费。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileExclusionSettings {
    pub enabled: bool,
    pub apply_to_search: bool,
    pub rules: Vec<FileExclusionRule>,
}

/// 可逐项禁用的 glob 规则，保留用户输入顺序供设置页定位错误。
#[derive(Debug, Clone, Deserialize)]
pub struct FileExclusionRule {
    pub pattern: String,
    pub enabled: bool,
}

/// 与界面语言无关的校验错误，由前端按行翻译展示。
#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct RuleError {
    pub index: usize,
    pub code: &'static str,
}

/// 一次查询编译一次的规则集合，文件树和搜索使用完全相同的匹配语义。
pub struct FileExclusions {
    entries: Vec<Pattern>,
    directories: Vec<Pattern>,
}

/// 将用户规则收敛到跨平台一致的受支持 glob 子集。
fn normalize_pattern(pattern: &str) -> Result<(String, bool), &'static str> {
    let pattern = pattern.trim().replace('\\', "/");
    if pattern.is_empty() {
        return Err("empty");
    }
    if pattern.len() > 1024 {
        return Err("tooLong");
    }
    if pattern.starts_with("//") || pattern.contains(':') {
        return Err("absolutePath");
    }
    if pattern.starts_with('!') || pattern.contains(['{', '}', '[', ']']) {
        return Err("unsupported");
    }
    let anchored = pattern.starts_with('/');
    let directories_only = pattern.ends_with('/');
    let body = pattern.strip_prefix('/').unwrap_or(&pattern);
    let body = body.strip_suffix('/').unwrap_or(body);
    if body.is_empty() {
        return Err("empty");
    }
    for segment in body.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err("pathSegment");
        }
        if segment.contains("**") && segment != "**" {
            return Err("globstar");
        }
    }
    if body.chars().any(char::is_control) {
        return Err("unsupported");
    }
    let glob = if !anchored && !body.contains('/') {
        format!("**/{body}")
    } else {
        body.to_string()
    };
    Ok((glob, directories_only))
}

/// 显式固定大小写和分隔符语义；glob 的 ? 按 Unicode 字符而不是 UTF-8 字节匹配。
fn matches_any(patterns: &[Pattern], candidate: &str) -> bool {
    let options = MatchOptions {
        case_sensitive: true,
        require_literal_separator: true,
        require_literal_leading_dot: false,
    };
    patterns
        .iter()
        .any(|pattern| pattern.matches_with(candidate, options))
}

impl FileExclusions {
    /// 校验所有规则（包含禁用规则），然后仅编译有效且启用的项；错误时整批拒绝。
    pub fn compile(settings: &FileExclusionSettings) -> Result<Self, Vec<RuleError>> {
        if settings.rules.len() > 256 {
            return Err(vec![RuleError {
                index: 256,
                code: "tooMany",
            }]);
        }
        let mut entries = Vec::new();
        let mut directories = Vec::new();
        let mut errors = Vec::new();
        for (index, rule) in settings.rules.iter().enumerate() {
            let parsed = normalize_pattern(&rule.pattern).and_then(|(pattern, directory_only)| {
                Pattern::new(&pattern)
                    .map(|glob| (glob, directory_only))
                    .map_err(|_| "invalidGlob")
            });
            match parsed {
                Ok((glob, directory_only)) if settings.enabled && rule.enabled => {
                    if directory_only {
                        directories.push(glob);
                    } else {
                        entries.push(glob);
                    }
                }
                Ok(_) => {}
                Err(code) => errors.push(RuleError { index, code }),
            }
        }
        if !errors.is_empty() {
            return Err(errors);
        }
        Ok(Self {
            entries,
            directories,
        })
    }

    /// 检查当前条目及全部祖先目录；根路径本身始终保留。
    pub fn is_excluded(&self, relative: &str, is_dir: bool) -> bool {
        let relative = relative.replace('\\', "/");
        if relative.is_empty() {
            return false;
        }
        if matches_any(&self.entries, &relative)
            || (is_dir && matches_any(&self.directories, &relative))
        {
            return true;
        }
        for (index, _) in relative.match_indices('/') {
            let ancestor = &relative[..index];
            if matches_any(&self.entries, ancestor) || matches_any(&self.directories, ancestor) {
                return true;
            }
        }
        false
    }

    /// 使用当前根目录的相对路径匹配，避免重叠工作区串用上下文。
    pub fn excludes_path(&self, path: &Path, root: &Path, is_dir: bool) -> bool {
        path.strip_prefix(root)
            .ok()
            .is_some_and(|relative| self.is_excluded(&relative.to_string_lossy(), is_dir))
    }
}

/// 设置页使用相同的后端编译器验证草稿，返回全部逐行错误。
#[tauri::command]
pub fn validate_file_exclusions(settings: FileExclusionSettings) -> Vec<RuleError> {
    FileExclusions::compile(&settings).err().unwrap_or_default()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// 从规则字符串创建启用配置，供匹配和目录集成测试复用。
    pub fn settings(patterns: &[&str]) -> FileExclusionSettings {
        FileExclusionSettings {
            enabled: true,
            apply_to_search: true,
            rules: patterns
                .iter()
                .map(|pattern| FileExclusionRule {
                    pattern: pattern.to_string(),
                    enabled: true,
                })
                .collect(),
        }
    }

    /// 共享样例的输入与期望，覆盖名称、glob、目录后代和跨平台路径。
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Fixture {
        patterns: Vec<String>,
        path: String,
        is_dir: bool,
        excluded: bool,
    }

    /// 文件树和搜索复用同一匹配器；样例同时约束目录剪枝和文件过滤语义。
    #[test]
    fn matches_shared_rule_fixtures() {
        let cases: Vec<Fixture> =
            serde_json::from_str(include_str!("../../tests/fixtures/file-exclusions.json"))
                .unwrap();
        for case in cases {
            let config = settings(&case.patterns.iter().map(String::as_str).collect::<Vec<_>>());
            let matcher = FileExclusions::compile(&config).ok().unwrap();
            assert_eq!(
                matcher.is_excluded(&case.path, case.is_dir),
                case.excluded,
                "patterns={:?}, path={}",
                case.patterns,
                case.path
            );
        }
    }

    /// 总开关和单项开关均可恢复可见性，保持规则本身不丢失。
    #[test]
    fn respects_global_and_individual_switches() {
        let mut config = settings(&[".git", "*.log"]);
        config.rules[0].enabled = false;
        let matcher = FileExclusions::compile(&config).ok().unwrap();
        assert!(!matcher.is_excluded(".git/config", false));
        assert!(matcher.is_excluded("a/error.log", false));
        config.enabled = false;
        assert!(!FileExclusions::compile(&config)
            .ok()
            .unwrap()
            .is_excluded("a/error.log", false));
    }

    /// 禁用规则也验证；全部错误保留行号，不会部分采用草稿。
    #[test]
    fn reports_all_invalid_rules_with_row_indices() {
        let patterns = [
            "",
            "../secret",
            "C:\\notes",
            "\\\\server\\share",
            "!notes",
            "{a,b}",
            "[ab]",
            "a**b",
            "a//b",
            "/",
            "./a",
        ];
        let mut config = settings(&patterns);
        config.rules[0].enabled = false;
        let errors = validate_file_exclusions(config);
        assert_eq!(errors.len(), patterns.len());
        assert_eq!(
            errors.iter().map(|error| error.index).collect::<Vec<_>>(),
            (0..patterns.len()).collect::<Vec<_>>()
        );
        assert!(validate_file_exclusions(settings(&[
            "notes/",
            "/notes/",
            "**/cache/",
            "文稿/*.md"
        ]))
        .is_empty());
    }

    /// 重叠工作区使用不同根路径，同一磁盘文件可以在其中一棵树内可见。
    #[test]
    fn anchors_each_workspace_independently() {
        let matcher = FileExclusions::compile(&settings(&["/drafts/"]))
            .ok()
            .unwrap();
        let path = Path::new("/workspace/project/drafts/note.md");
        assert!(matcher.excludes_path(path, Path::new("/workspace/project"), false));
        assert!(!matcher.excludes_path(path, Path::new("/workspace"), false));
        assert!(!matcher.excludes_path(
            Path::new("/workspace/project"),
            Path::new("/workspace/project"),
            true
        ));
    }
}
