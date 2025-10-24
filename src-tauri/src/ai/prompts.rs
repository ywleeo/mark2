use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptConfig {
    pub name: String,
    pub description: String,
    pub system_prompt: String,
}

/// 获取提示词配置目录
fn get_prompts_dir() -> PathBuf {
    // 在开发环境中，使用相对路径
    #[cfg(debug_assertions)]
    {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("prompts")
    }

    // 在生产环境中，提示词文件应该打包到资源目录
    #[cfg(not(debug_assertions))]
    {
        // TODO: 生产环境中从 resources 目录加载
        PathBuf::from("./prompts")
    }
}

/// 加载任务规划器提示词
pub fn load_task_planner_prompt() -> Result<String, String> {
    let path = get_prompts_dir().join("task_planner.json");
    load_prompt_from_file(&path)
}

/// 加载内容生成器提示词
pub fn load_content_generator_prompt() -> Result<String, String> {
    let path = get_prompts_dir().join("content_generator.json");
    load_prompt_from_file(&path)
}

/// 从文件加载提示词配置
fn load_prompt_from_file(path: &PathBuf) -> Result<String, String> {
    // 读取文件
    let content = fs::read_to_string(path)
        .map_err(|e| format!("无法读取提示词配置文件 {:?}: {}", path, e))?;

    // 解析 JSON
    let config: PromptConfig = serde_json::from_str(&content)
        .map_err(|e| format!("无法解析提示词配置: {}", e))?;

    Ok(config.system_prompt)
}

/// 获取默认的任务规划器提示词（作为后备）
pub fn get_default_task_planner_prompt() -> String {
    "你是一个写作助手的任务规划器。分析用户的输入，判断是简单问答还是需要执行任务。".to_string()
}

/// 获取默认的内容生成器提示词（作为后备）
pub fn get_default_content_generator_prompt() -> String {
    "你是一个专业的写作助手。直接输出内容，不要有多余的解释。".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_task_planner_prompt() {
        let result = load_task_planner_prompt();
        assert!(result.is_ok(), "应该能够加载任务规划器提示词");

        let prompt = result.unwrap();
        assert!(!prompt.is_empty(), "提示词不应为空");
        assert!(prompt.contains("任务规划器"), "应该包含关键词");
    }

    #[test]
    fn test_load_content_generator_prompt() {
        let result = load_content_generator_prompt();
        assert!(result.is_ok(), "应该能够加载内容生成器提示词");

        let prompt = result.unwrap();
        assert!(!prompt.is_empty(), "提示词不应为空");
        assert!(prompt.contains("写作助手"), "应该包含关键词");
    }
}
