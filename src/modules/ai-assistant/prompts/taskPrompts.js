/**
 * Task Prompts - 针对不同操作的精细化任务指令
 */

export const TASK_PROMPTS = {
    /**
     * 润色优化
     */
    polish: ({ selection, context, style }) => `## 任务：润色优化

**原文：**
${selection}

${context.before ? `**前文：**\n${context.before}\n` : ''}
${context.after ? `**后文：**\n${context.after}\n` : ''}

**文档风格特征：**
- 人称：${style.person}
- 语气：${style.tone}
- 用词：${style.vocabulary}
- 句式：${style.avgSentenceLength > 25 ? '长句为主' : style.avgSentenceLength > 15 ? '中等句式' : '短句为主'}

**优化方向（按优先级）：**
1. 清晰度：如有表达不清的地方，改得更明确
2. 简洁性：删除冗余，保留核心信息
3. 流畅度：优化句式衔接
4. 准确性：用词更精准

**严格要求：**
- 保持原文的人称（${style.person}）和语气（${style.tone}）
- 保持用词风格（${style.vocabulary}）
- 不改变核心观点和主要信息
- 只输出润色后的文本，不要解释`,

    /**
     * 续写
     */
    continue: ({ selection, context, style }) => `## 任务：续写

**需要续写的部分：**
${selection}

${context.before ? `**前文：**\n${context.before}\n` : ''}

**文档风格特征：**
- 人称：${style.person}
- 语气：${style.tone}
- 用词：${style.vocabulary}

**续写要求：**
1. 无缝衔接：读者不应感觉到这是 AI 写的，必须自然过渡
2. 风格一致：保持与前文相同的人称、语气、用词风格
3. 内容合理：符合前文逻辑，推进内容发展
4. 长度适中：续写 100-200 字，不要突然结束

**输出格式：**
只输出续写的内容，不要：
- 加引号或标记
- 写"续写如下"之类的说明
- 重复原文`,

    /**
     * 扩写
     */
    expand: ({ selection, context, style, expandRatio = 1.5 }) => `## 任务：扩写

**原文（较简略）：**
${selection}

${context.before ? `**前文参考：**\n${context.before}\n` : ''}
${context.after ? `**后文参考：**\n${context.after}\n` : ''}

**扩写策略：**
1. 补充细节：增加具体描写、例子、数据
2. 丰富层次：让内容更饱满，但不啰嗦
3. 保持节奏：扩写要自然，不能为了凑字数而水
4. 目标长度：约 ${Math.round(selection.length * expandRatio)} 字

**风格要求：**
- 保持 ${style.person}
- 保持 ${style.tone} 的语气
- 保持 ${style.vocabulary} 的用词风格

**输出格式：**
只输出扩写后的完整段落`,

    /**
     * 缩写/精简
     */
    compress: ({ selection, style, targetRatio = 0.6 }) => `## 任务：精简压缩

**原文：**
${selection}
（当前 ${selection.length} 字）

**压缩要求：**
1. 保留核心信息和关键观点
2. 删除冗余和次要细节
3. 目标长度：约 ${Math.round(selection.length * targetRatio)} 字
4. 保持可读性，不能变成干巴巴的大纲

**风格要求：**
保持原文的 ${style.person} 和 ${style.tone}

**输出格式：**
只输出压缩后的内容`,

    /**
     * 总结提炼
     */
    summarize: ({ selection }) => `## 任务：总结提炼

**原文：**
${selection}

**总结要求：**
1. 提炼出 3-5 个关键要点
2. 使用简洁的语言
3. 保持逻辑清晰
4. 每个要点一句话说明

**输出格式：**
- 要点1
- 要点2
- 要点3`,

    /**
     * 改写（换个说法）
     */
    rewrite: ({ selection, context, style }) => `## 任务：改写

**原文：**
${selection}

${context.before ? `**前文：**\n${context.before}\n` : ''}

**改写要求：**
1. 保持核心意思不变
2. 换一种表达方式
3. 可以调整句式结构和用词
4. 保持 ${style.person} 和 ${style.tone}

**输出格式：**
只输出改写后的内容`,

    /**
     * 翻译风格（正式 ↔ 口语）
     */
    changeStyle: ({ selection, targetStyle }) => `## 任务：转换风格

**原文：**
${selection}

**目标风格：**
${targetStyle === 'formal' ? '正式书面语' : '轻松口语化'}

**转换要求：**
1. 保持核心意思不变
2. ${targetStyle === 'formal' ? '使用正式、规范的书面语表达' : '使用自然、亲切的口语化表达'}
3. 调整用词和句式以符合目标风格

**输出格式：**
只输出转换后的内容`,

    /**
     * 翻译
     */
    translate: ({ selection }) => `## 任务：智能翻译

**原文：**
${selection}

**翻译要求：**
1. 自动识别原文语言
2. 如果原文是中文，翻译成英文
3. 如果原文是非中文（英文、日文等），翻译成中文
4. 保持原文的语气和风格
5. 翻译要准确、流畅、自然

**输出格式：**
只输出翻译后的文本，不要添加任何解释或说明`,
};

/**
 * 操作对应的标签
 */
export const ACTION_LABELS = {
    polish: '润色',
    continue: '续写',
    expand: '扩写',
    compress: '精简',
    summarize: '总结',
    rewrite: '改写',
    changeStyle: '转换风格',
    translate: '翻译',
};

/**
 * 不同操作的推荐温度参数
 */
export const ACTION_TEMPERATURES = {
    polish: 0.3,    // 润色要保守
    continue: 0.8,  // 续写需要创造性
    expand: 0.6,    // 扩写中等创造性
    compress: 0.3,  // 压缩要保守
    summarize: 0.4, // 总结要准确
    rewrite: 0.5,   // 改写中等
    changeStyle: 0.4, // 风格转换适中
    translate: 0.3, // 翻译要准确
};
