# DebugLogger 全局调试工具

DebugLogger 是一个全局调试工具，可以捕获所有 `console.log`、`console.error`、`console.warn`、`console.info`、`console.debug` 输出并写入到 `debug.log` 文件中，便于 AI 直接读取文件进行分析。

## 功能特性

- ✅ **全面拦截**: 捕获所有类型的 console 输出
- ✅ **文件写入**: 自动写入到项目根目录的 `debug.log` 文件
- ✅ **缓冲机制**: 使用内存缓冲，定时批量写入，提高性能
- ✅ **时间戳**: 每条日志都带有精确的时间戳
- ✅ **格式化**: 自动格式化对象和复杂数据结构
- ✅ **无侵入**: 保持原有 console 输出到开发者控制台
- ✅ **生命周期管理**: 自动清理和资源管理

## 使用方法

### 1. 初始化

在应用启动时调用：

```javascript
const { initDebugLogger } = require('./src/utils/DebugLogger');

// 初始化Debug Logger
const debugLogger = initDebugLogger();
```

### 2. 正常使用 console

初始化后，所有 console 输出会自动被捕获：

```javascript
console.log('普通日志');
console.info('信息日志');
console.warn('警告日志');
console.error('错误日志');
console.debug('调试日志');

// 对象也会被自动格式化
console.log('用户数据:', { id: 1, name: 'John' });
```

### 3. 手动写入自定义日志

```javascript
const { getDebugLogger } = require('./src/utils/DebugLogger');

const debugLogger = getDebugLogger();
debugLogger.writeCustomLog('自定义日志消息', 'CUSTOM');
```

### 4. 启用/禁用日志记录

```javascript
const debugLogger = getDebugLogger();

// 禁用日志记录（但保持console输出到控制台）
debugLogger.setEnabled(false);

// 重新启用
debugLogger.setEnabled(true);
```

### 5. 销毁（清理资源）

```javascript
const { destroyDebugLogger } = require('./src/utils/DebugLogger');

// 应用关闭时调用
destroyDebugLogger();
```

## 配置选项

在 `DebugLogger` 类中可以调整以下参数：

```javascript
class DebugLogger {
  constructor() {
    this.maxBufferSize = 100;    // 缓冲区最大条目数
    this.flushInterval = 1000;   // 自动flush间隔(毫秒)
  }
}
```

## 输出格式

每条日志的格式如下：

```
[2025-08-10T06:00:12.299Z] LOG: 这是一条日志消息
[2025-08-10T06:00:12.300Z] ERROR: 错误消息
[2025-08-10T06:00:12.301Z] WARN: 警告消息
```

对象会被格式化为 JSON：

```
[2025-08-10T06:00:12.302Z] LOG: 用户数据: {
  "id": 1,
  "name": "John",
  "address": {
    "city": "New York"
  }
}
```

## IPC 接口

主进程提供以下 IPC 接口：

- `clear-debug-log`: 清空 debug.log 文件
- `append-debug-log`: 追加内容到 debug.log 文件
- `read-debug-log`: 读取 debug.log 文件内容

## 文件位置

日志文件位置：`项目根目录/debug.log`

## AI 使用建议

AI 可以通过以下方式分析调试信息：

1. **直接读取文件**: 使用 Read tool 读取 `/Users/leeo/Code/mark2/debug.log`
2. **时间线分析**: 根据时间戳分析事件顺序
3. **错误追踪**: 搜索 ERROR 和 WARN 级别的日志
4. **性能分析**: 分析日志时间间隔和频率
5. **状态跟踪**: 跟踪应用状态变化

## 注意事项

- Debug Logger 在应用启动时会自动清空之前的日志
- 缓冲区满时会立即写入文件
- 页面卸载时会自动flush剩余日志
- 不会影响原有的console输出到开发者控制台
- 建议在生产环境中可以选择性禁用

## 测试

可以使用 `test-debug-logger.html` 测试文件来验证功能。