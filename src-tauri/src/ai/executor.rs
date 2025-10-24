use super::config::AiConfig;
use super::provider::{self, AiExecuteRequest};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Todo {
    pub id: String,
    pub content: String,
    pub active_form: String,
    pub status: TodoStatus,
    pub action: TodoAction,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TodoStatus {
    Pending,
    #[serde(rename = "in_progress")]
    InProgress,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TodoAction {
    #[serde(rename = "type")]
    pub action_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TaskPlan {
    pub intent: String, // "answer" | "task"
    #[serde(skip_serializing_if = "Option::is_none")]
    pub todos: Option<Vec<Todo>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
}

/// 分析用户意图并生成任务计划
pub async fn analyze_and_plan(
    prompt: &str,
    context: Option<&str>,
    config: &AiConfig,
) -> Result<TaskPlan, String> {
    // 从配置文件加载提示词，如果失败则使用默认值
    let system_prompt = super::prompts::load_task_planner_prompt()
        .unwrap_or_else(|e| {
            eprintln!("警告: 加载任务规划器提示词失败: {}", e);
            super::prompts::get_default_task_planner_prompt()
        });

    let request = AiExecuteRequest {
        prompt: prompt.to_string(),
        context: context.map(|s| s.to_string()),
        system_prompt: Some(system_prompt.to_string()),
        mode: None,
        history: None,  // 任务规划不需要对话历史
    };

    // 使用 fast 模型进行意图分析
    let mut fast_config = config.clone();
    fast_config.model = config.get_model_for_task("fast");

    let result = provider::execute(request, &fast_config).await?;

    // 解析 JSON 响应，先去掉可能的代码块标记
    let mut content = result.content.trim();

    // 如果被包裹在 ```json ... ``` 中，提取出来
    if content.starts_with("```json") {
        content = content.trim_start_matches("```json").trim_start_matches("```");
    }
    if content.ends_with("```") {
        content = content.trim_end_matches("```");
    }
    content = content.trim();

    let plan: TaskPlan = serde_json::from_str(content)
        .map_err(|e| format!("解析任务计划失败: {}，返回内容: {}", e, content))?;

    Ok(plan)
}

/// 生成内容（think 类型的 TODO）
pub async fn generate_content(
    todo: &Todo,
    user_prompt: &str,
    context: Option<&str>,
    history: Option<&[provider::ChatMessage]>,
    config: &AiConfig,
) -> Result<String, String> {
    // 从配置文件加载提示词，如果失败则使用默认值
    let system_prompt = super::prompts::load_content_generator_prompt()
        .unwrap_or_else(|e| {
            eprintln!("警告: 加载内容生成器提示词失败: {}", e);
            super::prompts::get_default_content_generator_prompt()
        });

    // 使用用户的原始需求作为 prompt
    let mut final_prompt = user_prompt.to_string();

    // 添加上下文信息（如果有）
    if let Some(ctx) = context {
        if !ctx.trim().is_empty() {
            final_prompt = format!("{}\n\n文件内容：\n{}", final_prompt, ctx);
        }
    }

    // 如果任务是生成内容，强调只输出结果本身
    if todo.action.action_type == "think" {
        final_prompt = format!(
            "{}\n\n记住：直接输出结果，不要有任何解释、说明或元信息。",
            final_prompt
        );
    }

    let request = AiExecuteRequest {
        prompt: final_prompt,
        context: context.map(|s| s.to_string()),
        system_prompt: Some(system_prompt.to_string()),
        mode: None,
        history: history.map(|h| h.to_vec()),  // 传递对话历史
    };

    // 使用 think 模型进行内容生成
    let mut think_config = config.clone();
    think_config.model = config.get_model_for_task("think");

    let result = provider::execute(request, &think_config).await?;
    Ok(result.content)
}
