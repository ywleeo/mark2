use super::executor;
use super::provider;
use super::AiExecuteRequest;
use crate::ai::config::AiConfig;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use tauri::Emitter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiTaskIntentEvent {
    pub id: String,
    pub intent: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiTaskTodoListEvent {
    pub id: String,
    pub todos: Vec<executor::Todo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiTaskTodoUpdateEvent {
    pub id: String,
    #[serde(rename = "todoId")]
    pub todo_id: String,
    pub status: String,
    pub output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiTaskSummaryEvent {
    pub id: String,
    pub message: String,
}

/// 执行AI任务
pub async fn execute_task(
    app_handle: &tauri::AppHandle,
    payload: AiExecuteRequest,
    task_id: String,
    workspace_root: Option<String>,
    config: &AiConfig,
) -> Result<String, String> {
    // 使用内部函数处理，这样可以捕获所有错误并发送失败事件
    let result = execute_task_internal(
        app_handle,
        payload,
        task_id.clone(),
        workspace_root,
        config,
    )
    .await;

    // 如果执行失败，确保发送失败事件
    if let Err(ref error) = result {
        let _ = app_handle.emit(
            "ai-task-summary",
            AiTaskSummaryEvent {
                id: task_id.clone(),
                message: format!("任务执行失败: {}", error),
            },
        );
    }

    result
}

/// 内部执行函数
async fn execute_task_internal(
    app_handle: &tauri::AppHandle,
    payload: AiExecuteRequest,
    task_id: String,
    workspace_root: Option<String>,
    config: &AiConfig,
) -> Result<String, String> {
    // 1. 分析意图并生成计划
    let plan = executor::analyze_and_plan(
        &payload.prompt,
        payload.context.as_deref(),
        config,
    )
    .await?;

    // 发送意图事件
    let _ = app_handle.emit(
        "ai-task-intent",
        AiTaskIntentEvent {
            id: task_id.clone(),
            intent: plan.intent.clone(),
        },
    );

    // 2. 如果是问答型，使用流式执行生成回答
    if plan.intent == "answer" {
        // 对于问答型，需要调用AI生成回答
        // 这里需要使用provider直接执行，或者创建一个简单的think todo
        println!("[task_executor] History received: {:?}", payload.history.as_ref().map(|h| h.len()));

        let answer_content = executor::generate_content(
            &executor::Todo {
                id: "answer".to_string(),
                content: "生成回答".to_string(),
                active_form: "正在生成回答".to_string(),
                status: executor::TodoStatus::Pending,
                action: executor::TodoAction {
                    action_type: "think".to_string(),
                    target: None,
                    params: None,
                },
                output: None,
            },
            &payload.prompt,
            payload.context.as_deref(),
            payload.history.as_deref(),  // 传递对话历史
            config,
        )
        .await?;

        // 发送summary事件
        let _ = app_handle.emit(
            "ai-task-summary",
            AiTaskSummaryEvent {
                id: task_id.clone(),
                message: answer_content.clone(),
            },
        );

        return Ok(answer_content);
    }

    // 3. 如果是任务型，执行TODO列表
    let mut todos = plan.todos.ok_or("任务计划缺少 todos")?;

    // 发送 TODO 列表
    let _ = app_handle.emit(
        "ai-task-todo-list",
        AiTaskTodoListEvent {
            id: task_id.clone(),
            todos: todos.clone(),
        },
    );

    // 4. 逐个执行 TODO
    let mut context_content = payload.context.clone();

    for todo in &mut todos {
        // 标记为 in_progress
        let _ = app_handle.emit(
            "ai-task-todo-update",
            AiTaskTodoUpdateEvent {
                id: task_id.clone(),
                todo_id: todo.id.clone(),
                status: "in_progress".to_string(),
                output: None,
            },
        );

        let result = execute_single_todo(
            todo,
            &payload.prompt,
            &mut context_content,
            &workspace_root,
            payload.history.as_deref(),  // 传递对话历史
            config,
            app_handle,
            &task_id,
        )
        .await;

        match result {
            Ok(output) => {
                // 标记为 completed
                let _ = app_handle.emit(
                    "ai-task-todo-update",
                    AiTaskTodoUpdateEvent {
                        id: task_id.clone(),
                        todo_id: todo.id.clone(),
                        status: "completed".to_string(),
                        output: Some(output),
                    },
                );
            }
            Err(err) => {
                // 标记为 failed
                let _ = app_handle.emit(
                    "ai-task-todo-update",
                    AiTaskTodoUpdateEvent {
                        id: task_id.clone(),
                        todo_id: todo.id.clone(),
                        status: "failed".to_string(),
                        output: Some(err.clone()),
                    },
                );
                return Err(err);
            }
        }
    }

    // 5. 发送完成事件
    let summary_message = generate_summary_message(&todos, &context_content);

    let _ = app_handle.emit(
        "ai-task-summary",
        AiTaskSummaryEvent {
            id: task_id.clone(),
            message: summary_message.clone(),
        },
    );

    Ok(summary_message)
}

/// 执行单个TODO
async fn execute_single_todo(
    todo: &executor::Todo,
    user_prompt: &str,
    context_content: &mut Option<String>,
    workspace_root: &Option<String>,
    history: Option<&[provider::ChatMessage]>,
    config: &AiConfig,
    app_handle: &tauri::AppHandle,
    task_id: &str,
) -> Result<String, String> {
    match todo.action.action_type.as_str() {
        "read" => execute_read_action(todo, workspace_root),
        "write" => execute_write_action(todo, context_content, workspace_root),
        "think" => execute_think_action(todo, user_prompt, context_content, history, config).await,
        "replace" => execute_replace_action(todo, workspace_root),
        "insert" => {
            execute_insert_action(todo, context_content, workspace_root, app_handle, task_id).await
        }
        _ => Err(format!("不支持的操作类型: {}", todo.action.action_type)),
    }
}

/// 执行读取操作
fn execute_read_action(
    todo: &executor::Todo,
    workspace_root: &Option<String>,
) -> Result<String, String> {
    let target = todo
        .action
        .target
        .as_ref()
        .ok_or("read 操作缺少 target")?;

    let root_path = workspace_root.as_ref().map(|s| Path::new(s));
    let full_path = resolve_file_path(target, root_path)?;

    let content = fs::read_to_string(&full_path).map_err(|e| format!("读取文件失败: {}", e))?;

    let preview = if content.chars().count() > 100 {
        let truncated: String = content.chars().take(100).collect();
        format!("{}...", truncated)
    } else {
        content.clone()
    };

    Ok(format!("已读取: {}", preview))
}

/// 执行写入操作
fn execute_write_action(
    todo: &executor::Todo,
    context_content: &mut Option<String>,
    workspace_root: &Option<String>,
) -> Result<String, String> {
    let target = todo
        .action
        .target
        .as_ref()
        .ok_or("write 操作缺少 target")?;

    let content = context_content
        .as_ref()
        .ok_or("write 操作需要先通过 think 生成内容")?;

    let root_path = workspace_root.as_ref().map(|s| Path::new(s));
    let full_path = resolve_file_path(target, root_path)?;

    // 确保父目录存在
    if let Some(parent) = Path::new(&full_path).parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
        }
    }

    fs::write(&full_path, &content).map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(format!("已写入 {} 字符到文件", content.len()))
}

/// 执行思考操作
async fn execute_think_action(
    todo: &executor::Todo,
    user_prompt: &str,
    context_content: &mut Option<String>,
    history: Option<&[provider::ChatMessage]>,
    config: &AiConfig,
) -> Result<String, String> {
    let content = executor::generate_content(
        todo,
        user_prompt,
        context_content.as_deref(),
        history,
        config,
    )
    .await?;

    // 更新上下文
    *context_content = Some(content.clone());

    // 生成预览
    let preview = if content.chars().count() > 50 {
        let truncated: String = content.chars().take(50).collect();
        format!("{}...", truncated)
    } else {
        content.clone()
    };
    Ok(format!("已生成: {}", preview))
}

/// 执行替换操作
fn execute_replace_action(
    todo: &executor::Todo,
    workspace_root: &Option<String>,
) -> Result<String, String> {
    let target = todo
        .action
        .target
        .as_ref()
        .ok_or("replace 操作缺少 target")?;

    let params = todo
        .action
        .params
        .as_ref()
        .ok_or("replace 操作缺少 params")?;

    let old_text = params
        .get("old")
        .and_then(|v| v.as_str())
        .ok_or("replace 操作缺少 old 参数")?;
    let new_text = params
        .get("new")
        .and_then(|v| v.as_str())
        .ok_or("replace 操作缺少 new 参数")?;

    let root_path = workspace_root.as_ref().map(|s| Path::new(s));
    let full_path = resolve_file_path(target, root_path)?;

    let content = fs::read_to_string(&full_path).map_err(|e| format!("读取文件失败: {}", e))?;

    if !content.contains(old_text) {
        return Err(format!("文件中未找到要替换的内容: {}", old_text));
    }

    let new_content = content.replace(old_text, new_text);

    fs::write(&full_path, new_content).map_err(|e| format!("写入文件失败: {}", e))?;

    Ok("替换成功".to_string())
}

/// 执行插入操作
async fn execute_insert_action(
    todo: &executor::Todo,
    context_content: &Option<String>,
    workspace_root: &Option<String>,
    app_handle: &tauri::AppHandle,
    task_id: &str,
) -> Result<String, String> {
    let target = todo
        .action
        .target
        .as_ref()
        .ok_or("insert 操作缺少 target")?;

    let params = todo
        .action
        .params
        .as_ref()
        .ok_or("insert 操作缺少 params")?;

    let position = params
        .get("position")
        .and_then(|v| v.as_str())
        .ok_or("insert 操作缺少 position 参数")?;

    // 从 context 或 params 中获取要插入的内容
    let content_to_insert = if let Some(ctx_content) = context_content {
        ctx_content.as_str()
    } else {
        params
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or("insert 操作缺少 content")?
    };

    // 如果是 cursor 位置，发送事件让前端处理
    if position == "cursor" {
        let _ = app_handle.emit(
            "ai-task-insert-at-cursor",
            serde_json::json!({
                "id": task_id,
                "todo_id": todo.id,
                "content": content_to_insert,
            }),
        );
        Ok("已插入到光标位置".to_string())
    } else {
        // 文件头部或尾部插入
        let root_path = workspace_root.as_ref().map(|s| Path::new(s));
        let full_path = resolve_file_path(target, root_path)?;

        let existing =
            fs::read_to_string(&full_path).map_err(|e| format!("读取文件失败: {}", e))?;

        let new_content = match position {
            "start" | "beginning" => format!("{}{}", content_to_insert, existing),
            "end" => format!("{}{}", existing, content_to_insert),
            _ => return Err(format!("不支持的插入位置: {}", position)),
        };

        fs::write(&full_path, new_content).map_err(|e| format!("写入文件失败: {}", e))?;

        Ok("插入成功".to_string())
    }
}

/// 解析文件路径
fn resolve_file_path(target: &str, root_path: Option<&Path>) -> Result<String, String> {
    if Path::new(target).is_absolute() {
        Ok(target.to_string())
    } else if let Some(root) = root_path {
        let full_path = root.join(target)
            .to_str()
            .ok_or("路径转换失败")?
            .to_string();
        Ok(full_path)
    } else {
        Ok(target.to_string())
    }
}

/// 生成任务总结消息
fn generate_summary_message(
    todos: &[executor::Todo],
    context_content: &Option<String>,
) -> String {
    if let Some(content) = context_content {
        let last_todo = todos.last();
        if let Some(todo) = last_todo {
            if todo.action.action_type == "think" {
                // 这是一个需要回答的任务，返回生成的内容
                return content.clone();
            }
        }
    }
    "任务执行完成".to_string()
}
