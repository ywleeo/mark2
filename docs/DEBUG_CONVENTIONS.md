# Debug Conventions

## 目标

为重构阶段建立统一日志和 trace 约定，避免继续临时、无结构地打日志。

## 日志域

- `documents`
- `workspace`
- `views`
- `commands`
- `features`
- `export`
- `io`

## 本地开关

- `localStorage.mark2_debug_log_level`
  可选值：`debug` / `info` / `warn` / `error`
- `localStorage.mark2_debug_domains`
  逗号分隔，例如：`documents,io`
- `localStorage.mark2_trace_enabled`
  `1` 表示启用最小 trace 记录
- `localStorage.mark2_debug_file_logging`
  默认开启；写入 `0` 表示关闭日志文件落盘

## 使用原则

- 新增关键日志优先使用结构化对象，不拼长字符串
- 关键链路至少记录：输入、状态变更、写盘目标、失败原因
- 临时排查日志要么删掉，要么升格成正式日志域
- 文件日志默认写入，便于重构阶段直接验收链路；如需静默可显式关闭
- 统一 `Logger` 当前默认只写文件，不再向控制台或开发终端重复输出

## 文件日志

- 当前格式：`JSON Lines`
  每行一条 JSON，字段包含 `ts / domain / level / message / context`
- 当前文件名：`mark2-debug.log`
- 日志目录：应用 `AppLog` 目录
  当前 macOS 沙盒环境通常位于 `~/Library/Containers/cc.altron.mark2/Data/Library/Logs/Mark2/`
- 建议重构调试时同时设置：
  - `localStorage.mark2_debug_log_level = 'debug'`
  - `localStorage.mark2_debug_domains = 'documents,io,workspace,commands'`
- 如需临时关闭文件落盘：
  - `localStorage.mark2_debug_file_logging = '0'`

## 当前阶段重点

- `documents`
  关注 open / activate / rename / dirty / close / active-path sync
- `io`
  关注 save / auto save / load / write target
- `workspace`
  关注 tab / fileTree / select / openFiles / restore state
