export const CARD_TEMPLATES = [
    {
        id: 'warm-linen',
        color: '#f7f3ec',
        theme: 'light',
        contentMaxHeight: 309, // 453 - padding(54+90)
        baseFontSize: 13.5,
        maxLines: 7,
        llmPrompt: `请将以下内容整理为「文艺暖色」风格的卡片文案，输出 HTML。

风格：文艺优雅，像散文或诗句，有情感厚度。
内容原则：不改写、不删减、不添加任何文字。可以将长句在自然停顿处拆分为多个 <p>，让每行短而有节奏感。原文超过 7 行时才提炼压缩，确保总行数不超过 7 行。

排版规则（严格遵守）：
- 每个独立的意群或诗句单独一个 <p> 段落
- 用 <em> 标记诗意、意象类词汇
- 用 <strong> 标记情感最重的核心短语（全文最多 1-2 处）
- 适当断句，让每行视觉上短而有韵律感

示例输出格式：
<p>真正的平静，</p>
<p>不是避开<em>车马喧嚣</em>，</p>
<p>而是在心中<strong>修篱种菊</strong>。</p>

只输出 HTML，不要加任何说明或代码块标记。`,
        buildDecorations: () => [
            { class: 'card-deco card-deco--wl-frame', content: '' },
            { class: 'card-deco card-deco--wl-corner-tl', content: '' },
            { class: 'card-deco card-deco--wl-corner-br', content: '' },
            { class: 'card-deco card-deco--wl-quote', content: '\u201c' },
            { class: 'card-deco card-deco--wl-divider', content: '' },
            { class: 'card-deco card-deco--wl-author', content: 'mark\u00b2 \u00b7 \u968f\u624b\u8bb0' },
        ],
    },
    {
        id: 'gradient-blush',
        color: '#fce8f4',
        theme: 'light',
        contentMaxHeight: 349, // 453 - padding(58+46)
        baseFontSize: 14,
        maxLines: 9,
        llmPrompt: `请将以下内容整理为「现代粉紫」风格的卡片文案，输出 HTML。

风格：现代活泼，有温度，适合分享观点和生活感悟。
内容原则：不改写、不删减、不添加任何文字。可以将长句在自然停顿处拆分为多个 <p>，让每行短而有节奏感。原文超过 9 行时才提炼压缩，确保总行数不超过 9 行。

排版规则（严格遵守）：
- 每个观点或层次单独一个 <p> 段落
- 用 <strong> 标记关键词和最想让人记住的短语（3-5 处）
- 用 <em> 修饰细腻的情绪或感受词
- 可以用短句+长句交替，增加节奏感

示例输出格式：
<p>即使身处繁华，</p>
<p>也能找到<strong>属于自己的一寸宁静</strong>。</p>
<p>那是心灵深处的<em>自留地</em>，</p>
<p>无论外界怎样喧嚣，<strong>它始终在那里</strong>。</p>

只输出 HTML，不要加任何说明或代码块标记。`,
        buildDecorations: () => [
            { class: 'card-deco card-deco--gb-topbar', content: '' },
            { class: 'card-deco card-deco--gb-tag', content: '\u2726 \u4eca\u65e5\u611f\u609f' },
            { class: 'card-deco card-deco--gb-date', content: new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }) },
            { class: 'card-deco card-deco--gb-dots', content: '\u25cf\u25cf\u25cf' },
        ],
    },
    {
        id: 'ink-stone',
        color: '#141820',
        theme: 'dark',
        contentMaxHeight: 357, // 453 - padding(50+46)
        baseFontSize: 13.5,
        maxLines: 9,
        llmPrompt: `请将以下内容整理为「深色墨石」风格的卡片文案，输出 HTML。

风格：深沉凝练，有哲思和力量感，每个字都要有分量。
内容原则：如果原文在 9 行以内（每行 ≤ 16 字），只加排版标签，不改写任何文字。原文超过 9 行时才提炼压缩，确保总行数不超过 9 行。

排版规则（严格遵守）：
- 每个独立的思想单独一个 <p> 段落
- 用 <strong> 标记核心论断（1-3 处，要有重量感）
- 用 <em> 强调关键概念（1-2 处）
- 句子要短，留白要多

示例输出格式：
<p>繁华中寻得宁静，</p>
<p>不在于<em>外部环境</em>，</p>
<p>而在于<strong>内心的笃定</strong>。</p>

只输出 HTML，不要加任何说明或代码块标记。`,
        buildDecorations: () => [
            { class: 'card-deco card-deco--is-glow', content: '' },
            { class: 'card-deco card-deco--is-header-line', content: '' },
            { class: 'card-deco card-deco--is-header-dot', content: '' },
            { class: 'card-deco card-deco--is-header-text', content: 'Note' },
            { class: 'card-deco card-deco--is-footer', content: `${new Date().toLocaleDateString('zh-CN')} \u00b7 mark\u00b2` },
            { class: 'card-deco card-deco--is-mark', content: '\u2767' },
        ],
    },
];
