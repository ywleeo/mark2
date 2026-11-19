/** Build independent English and Chinese pages from shared structure and localized product copy. */
import { mkdir, writeFile } from "node:fs/promises";
const base = "https://ywleeo.github.io/mark2/";
const release = { price: "US$14.99" };
const copy = {
  en: {
    lang: "en",
    prefix: "",
    other: "zh/",
    switch: "中文",
    switchLabel: "Read this website in Chinese",
    title: "Mark2 — A focused Markdown writing workspace",
    description:
      "For independent developers, technical writers, and curious minds. Read, draft, refine, and share in one local Markdown workspace for Mac.",
    nav: ["Who it is for", "The workflow", "Screenshots", "Get Mark2"],
    eyebrow: "MARKDOWN WORKSPACE FOR MAC",
    headline: "Read. Write.<br>Make it clear.",
    intro:
      "A focused Markdown workspace for people who explain things. Bring your research, find your words, and turn a working draft into something worth sharing.",
    primary: "Explore the workflow",
    coming: "Mac App Store · Coming soon",
    availability:
      "Planned launch price " + release.price + " · One-time purchase",
    facts: ["Local files", "No Mark2 account", "No subscription"],
    heroAlt:
      "Mark2 Editorial layout showing an English essay with an original desk illustration",
    heroCap: "Your words, with a little more room to think.",
    audienceTitle: "For the work behind<br>your next good piece.",
    audienceIntro:
      "A place for the drafts that become explanations, decisions, and ideas other people can use.",
    audiences: [
      [
        "Independent developers",
        "Explain the work.",
        "Write a design proposal, a release note, or the tutorial you wish you had found. Keep code, diagrams, and the reasoning together.",
      ],
      [
        "Technical writers",
        "Make complexity readable.",
        "Turn source material into clear documentation. Move between visual Markdown and source without changing tools.",
      ],
      [
        "Writers & curious minds",
        "Follow a thought further.",
        "Collect reading notes, develop an essay, or draft a newsletter. Keep the useful details and find the thread that connects them.",
      ],
    ],
    flowTitle: "A short path from<br>source material to finished work.",
    flowIntro:
      "Read a little. Write a little. Make one thing clearer. The workspace stays with you through the whole process.",
    steps: [
      [
        "01",
        "Read with context.",
        "Open your research beside your draft. PDFs, code, images, and spreadsheets stay close to the idea you are working on.",
        "Visual Markdown and source mode · Folder workspace · Document outline",
      ],
      [
        "02",
        "Give the draft some room.",
        "Use Classic when you are moving through a project, or Editorial when you want to face one piece at a time. Focus and typewriter modes help you stay with the sentence.",
        "Two layouts · Focus mode · Typewriter mode",
      ],
      [
        "03",
        "Refine it in your own voice.",
        "Ask optional AI to continue at the cursor, polish a selection, translate a passage, or discuss the current document. Review suggestions before making them part of your work.",
        "Bring your own provider and API key · Provider fees are separate",
      ],
      [
        "04",
        "Make something useful to share.",
        "Export a finished document or turn a paragraph into an image card. For optional link sharing, connect your own GitHub account through a Gist token.",
        "Document exports · Image cards · Optional Gist sharing",
      ],
    ],
    techTitle: "When words need<br>a little structure.",
    techIntro:
      "Explain the architecture. Work through the equation. Let the diagram carry its share of the explanation.",
    techs: [
      [
        "Diagrams that live with the text",
        "Write Mermaid flowcharts and sequences directly in your Markdown. Keep the explanation and the diagram in the same file.",
        "diagrams",
        "Mark2 displaying an English release-process document with a Mermaid flowchart",
      ],
      [
        "Notes that keep the equations readable",
        "Use KaTeX math, tables, and code blocks for study notes, research, and technical articles.",
        "math",
        "Mark2 displaying English study notes with rendered mathematical equations",
      ],
    ],
    galleryTitle: "A real workspace,<br>in English.",
    galleryIntro:
      "See the editor, document outline, focus mode, and image cards with English sample documents.",
    shots: [
      [
        "editorial",
        "A quiet place to draft",
        "An English essay, an original illustration, and a draft library that follows your writing.",
      ],
      [
        "classic",
        "A workspace for the whole project",
        "Files, folders, an outline, and the document you are working on.",
      ],
      [
        "focus",
        "Stay with the sentence",
        "Focus mode fades the surrounding paragraphs while you write.",
      ],
      [
        "cards",
        "A thought, ready to travel",
        "Turn selected English text into a shareable image card.",
      ],
    ],
    trustTitle: "Your files.<br>Your way of working.",
    trusts: [
      [
        "Local Markdown",
        "Keep documents in folders you choose. Your files remain usable in other tools.",
      ],
      [
        "Room to recover",
        "Recovery copies and version history help you revisit earlier work. A restored version is yours to review before saving.",
      ],
      [
        "Optional sharing",
        "AI and Gist sharing require your permission. You can withdraw future sharing consent in Settings.",
      ],
    ],
    priceTitle: "One purchase.<br>The whole workspace.",
    priceLead: "All features. No Pro tier. No recurring subscription.",
    priceNote:
      "Planned US launch price. Regional prices will be shown by Apple. The new version will be available on the Mac App Store once it launches.",
    priceExisting:
      "Previously acquired the free App Store version? You keep access.",
    platform: "For Apple Silicon Macs · macOS 13 or later",
    faqTitle: "A few things to know.",
    faqs: [
      [
        "Does the purchase include AI?",
        "All AI tools are available in the app, but you use your own provider account and API key. Provider usage charges are separate; Mark2 does not include AI credits. Local writing does not require AI.",
      ],
      [
        "Where are my documents stored?",
        "In local files and application data on your Mac. Mark2 does not require its own cloud account. Optional AI and Gist features send the content needed for the action you authorize.",
      ],
      [
        "What about updates?",
        "Minor updates to the current major version are included. Future major upgrades may be offered separately. ",
      ],
      [
        "What happens to the GitHub edition?",
        "Existing releases and updates remain available for now. We plan to move GitHub distribution toward source code only, with the Mac App Store as the official purchase channel.",
      ],
      [
        "Can I use it on Windows?",
        "The Mac App Store release is for Mac. This website currently focuses on that edition; existing GitHub releases are managed separately.",
      ],
    ],
    footer: "A little more room for your next good idea.",
    privacy: "Privacy",
    source: "Source code",
    top: "Back to top",
    images: {
      editorial: "en/editorial.webp",
      classic: "en/classic.webp",
      focus: "en/focus.webp",
      cards: "en/cards.webp",
      diagrams: "en/diagrams.webp",
      math: "en/math.webp",
    },
  },
  zh: {
    lang: "zh-CN",
    prefix: "../",
    other: "../",
    switch: "English",
    switchLabel: "Read this website in English",
    title: "Mark2 — 专注写作与阅读的 Markdown 工作区",
    description:
      "为独立开发者、技术作者和内容创作者打造的本地 Markdown 工作区。阅读资料、撰写文稿、按需使用 AI 修改，再导出分享。",
    nav: ["适合谁用", "使用流程", "真实截图", "获取 Mark2"],
    eyebrow: "Mac 上的 Markdown 工作区",
    headline: "读进去。<br>写明白。",
    intro:
      "为需要把事情讲清楚的人准备的 Markdown 工作区。带着资料开始，沿着思路写下去，把草稿变成值得分享的内容。",
    primary: "看看完整使用流程",
    coming: "Mac App Store · 即将上架",
    availability: "计划首发价 " + release.price + " · 一次购买",
    facts: ["本地文件", "无需 Mark2 账号", "无订阅"],
    heroAlt: "Mark2 编辑部模式，展示中文文章及配图",
    heroCap: "给你的文字，也给思考，多留一点空间。",
    audienceTitle: "写的不只是文字，<br>也是解释、判断和思考。",
    audienceIntro: "让技术方案、文章和学习笔记，都有一个从资料走向成稿的地方。",
    audiences: [
      [
        "独立开发者",
        "把做过的事讲清楚。",
        "写一份设计方案、一篇发布说明，或一篇自己曾经需要的教程。代码、图表和推理，放在同一份文稿里。",
      ],
      [
        "技术作者",
        "让复杂的内容变得可读。",
        "从资料中提炼结构，逐步完成文档。可视化 Markdown 与源码模式随时切换，不必反复更换工具。",
      ],
      [
        "内容创作者与学习者",
        "让一个想法，再走远一点。",
        "整理阅读笔记，展开一篇文章，或起草一期通讯。留下有用的细节，找到贯穿其中的线索。",
      ],
    ],
    flowTitle: "从手边的资料，<br>到可以交出去的作品。",
    flowIntro:
      "读一点，写一点，把一件事解释得更清楚。整个过程，都在同一个工作区。",
    steps: [
      [
        "01",
        "带着上下文阅读。",
        "把资料和草稿放在一起。PDF、代码、图片和表格，都可以围绕当前正在写的内容展开。",
        "可视化与源码编辑 · 文件夹工作区 · 文档大纲",
      ],
      [
        "02",
        "给草稿一点空间。",
        "在项目文件之间切换时，用经典模式；想专心面对一篇稿子时，用编辑部模式。专注与打字机模式，让你留在正在写的那句话里。",
        "两种布局 · 专注模式 · 打字机模式",
      ],
      [
        "03",
        "按你的意思，把话说得更好。",
        "按需使用 AI 在光标处续写，对选中文字润色、翻译，或围绕当前文稿对话。是否采纳，仍由你决定。",
        "自选服务商与 API Key · 模型服务费用另计",
      ],
      [
        "04",
        "把想法交到别人手上。",
        "导出完整文稿，或把一段文字制作成图片卡片。需要链接分享时，可以使用自己的 GitHub Token 生成 Gist 页面。",
        "文稿导出 · 图片卡片 · 可选 Gist 分享",
      ],
    ],
    techTitle: "有些说明，<br>需要一点结构。",
    techIntro: "讲清楚架构，推导一个公式，让图表分担文字的工作。",
    techs: [
      [
        "图表和解释，在同一份文稿里",
        "直接在 Markdown 中编写 Mermaid 流程图和时序图，维护说明时，也能一起维护图表。",
        "diagrams",
        "Mark2 中文技术方案中的 Mermaid 流程图",
      ],
      [
        "让公式回到容易阅读的样子",
        "KaTeX 公式、表格和代码块，为课程笔记、研究材料和技术文章提供清晰的表达。",
        "math",
        "Mark2 中文学习笔记中的公式与表格",
      ],
    ],
    galleryTitle: "真实工作区，<br>真实写作过程。",
    galleryIntro: "看看真实应用中的文稿、写作模式和卡片导出。",
    shots: [
      [
        "editorial",
        "一张安静的写作桌",
        "文章、配图，以及跟着写作节奏整理的文稿库。",
      ],
      [
        "classic",
        "一个项目的资料，都在手边",
        "文件、文件夹、文档大纲，还有你正在写的那篇稿子。",
      ],
      [
        "focus",
        "把注意力留在当前句子",
        "专注模式淡化周围段落，打字机模式让当前行保持居中。",
      ],
      [
        "cards",
        "让一段好文字，方便分享",
        "选中文字，转换为具有排版风格的图片卡片。",
      ],
    ],
    trustTitle: "你的文件，<br>你的工作方式。",
    trusts: [
      [
        "本地 Markdown",
        "文稿保存在你选择的文件夹，也可以继续在其他工具中使用。",
      ],
      [
        "给修改留条回路",
        "恢复副本和版本历史帮助你回看之前的内容。恢复后先成为未保存修改，确认后再保存。",
      ],
      [
        "共享由你决定",
        "AI 与 Gist 分享需要取得授权。可以在设置中撤回后续共享许可。",
      ],
    ],
    priceTitle: "一次购买。<br>全部功能。",
    priceLead: "不拆分 Pro，不设置循环订阅。",
    priceNote:
      "计划中的美国区首发价；其他地区以 Apple 显示的价格为准。新版上架后可在 Mac App Store 购买。",
    priceExisting: "此前免费获取过商店版？已有使用权保留。",
    platform: "适用于 Apple Silicon Mac · macOS 13 或以上",
    faqTitle: "你可能还想知道。",
    faqs: [
      [
        "购买包含 AI 额度吗？",
        "应用内的 AI 工具全部开放，但需要使用自己的服务商账号和 API Key。模型服务商可能另行收费，购买 Mark2 不包含调用额度。本地写作不依赖 AI。",
      ],
      [
        "文稿保存在哪里？",
        "保存在 Mac 的本地文件与应用数据中，无需注册 Mark2 云账号。使用可选 AI 或 Gist 功能时，只在授权后发送完成操作所需的内容。",
      ],
      [
        "之后的更新如何收费？",
        "当前大版本的小更新包含在购买中，未来重大升级可能单独收费。",
      ],
      [
        "GitHub 版会怎样调整？",
        "现有发布包与更新暂时保留。之后会逐步转向只提供源码，以 Mac App Store 作为官方购买渠道。",
      ],
      [
        "Windows 版呢？",
        "Mac App Store 版仅适用于 Mac。官网目前聚焦这一版本，GitHub 上已有的发布包单独维护。",
      ],
    ],
    footer: "为你的下一个好想法，多留一点空间。",
    privacy: "隐私政策",
    source: "项目源码",
    top: "返回顶部",
    images: {
      editorial: "editorial.png",
      classic: "classic.png",
      focus: "focus.png",
      cards: "card-export.png",
      diagrams: "mermaid.png",
      math: "math.png",
    },
  },
};
/** Escape text inserted into attributes or text-only content. */
function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
/** Render the shared semantic layout with language-specific copy and real screenshots. */
function page(c) {
  const p = c.prefix;
  const url = base + (c.lang === "en" ? "" : "zh/");
  const dimensions = {
    en: { standard: [1800, 1122], cards: [1800, 1161] },
    "zh-CN": {
      standard: [1400, 978],
      focus: [2000, 1397],
      cards: [2000, 1397],
    },
  }[c.lang];
  /** Render a locally hosted screenshot with its actual aspect ratio. */
  const shot = (name, alt, loading = "lazy") => {
    const [width, height] = dimensions[name] ?? dimensions.standard;
    return `<img src="${p}assets/${c.images[name]}" alt="${esc(alt)}" loading="${loading}" decoding="async" width="${width}" height="${height}">`;
  };
  return `<!doctype html>
<!-- Generated by site/build.mjs; edit the localized source, not this output. -->
<html lang="${c.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.title)}</title><meta name="description" content="${esc(c.description)}"><meta name="theme-color" content="#faf8f3"><link rel="canonical" href="${url}"><link rel="alternate" hreflang="en" href="${base}"><link rel="alternate" hreflang="zh-Hans" href="${base}zh/"><link rel="alternate" hreflang="x-default" href="${base}"><link rel="icon" type="image/svg+xml" href="${p}assets/logo.svg"><meta property="og:title" content="${esc(c.title)}"><meta property="og:description" content="${esc(c.description)}"><meta property="og:url" content="${url}"><meta property="og:type" content="website"><meta property="og:locale" content="${c.lang === "en" ? "en_US" : "zh_CN"}"><meta property="og:image" content="${base}assets/${c.images.editorial}"><meta name="twitter:card" content="summary_large_image"><link rel="stylesheet" href="${p}assets/site.css"><script src="${p}assets/site.js" defer></script></head><body>
<a class="skip" href="#main">${c.lang === "en" ? "Skip to content" : "跳到正文"}</a>
<header class="site-header"><div class="wrap header-inner"><a href="#" class="brand" aria-label="Mark2"><img src="${p}assets/logo.svg" alt="" width="35" height="35"><span>Mark2</span></a><nav aria-label="${c.lang === "en" ? "Main navigation" : "主导航"}">${["audience", "workflow", "screenshots", "get"].map((id, i) => `<a href="#${id}">${c.nav[i]}</a>`).join("")}<a class="language" href="${c.other}" lang="${c.lang === "en" ? "zh-CN" : "en"}" aria-label="${c.switchLabel}">${c.switch}<span aria-hidden="true"> ↗</span></a></nav></div></header>
<main id="main"><section class="hero wrap"><p class="eyebrow">${c.eyebrow}</p><h1>${c.headline}</h1><p class="hero-intro">${c.intro}</p><div class="hero-actions"><a class="button" href="#workflow">${c.primary}<span aria-hidden="true"> ↗</span></a><span class="release-status">${c.coming}</span></div><p class="availability">${c.availability}</p><ul class="facts">${c.facts.map((t) => `<li>${t}</li>`).join("")}</ul><figure class="hero-shot">${shot("editorial", c.heroAlt, "eager")}<figcaption>${c.heroCap}</figcaption></figure></section>
<section class="wrap audience" id="audience"><div class="section-heading"><p class="eyebrow">${c.lang === "en" ? "MADE FOR YOUR KIND OF WORK" : "从真实的工作开始"}</p><h2>${c.audienceTitle}</h2><p>${c.audienceIntro}</p></div><div class="three-columns">${c.audiences.map(([label, title, text]) => `<article><p class="overline">${label}</p><h3>${title}</h3><p>${text}</p></article>`).join("")}</div></section>
<section class="workflow" id="workflow"><div class="wrap"><div class="section-heading"><p class="eyebrow">${c.lang === "en" ? "READ → DRAFT → REFINE → SHARE" : "阅读 → 写作 → 修改 → 分享"}</p><h2>${c.flowTitle}</h2><p>${c.flowIntro}</p></div><div class="workflow-grid">${c.steps.map(([n, title, text, detail]) => `<article><span class="step-number">${n}</span><h3>${title}</h3><p>${text}</p><p class="detail">${detail}</p></article>`).join("")}</div><figure class="wide-shot">${shot("classic", c.shots[1][2])}</figure></div></section>
<section class="wrap technical"><div class="section-heading"><p class="eyebrow">${c.lang === "en" ? "THINK IN WORDS, DIAGRAMS, AND EQUATIONS" : "用文字，也用图表和公式"}</p><h2>${c.techTitle}</h2><p>${c.techIntro}</p></div><div class="two-columns">${c.techs.map(([title, text, name, alt]) => `<article class="feature-shot"><figure>${shot(name, alt)}</figure><h3>${title}</h3><p>${text}</p></article>`).join("")}</div></section>
<section class="gallery" id="screenshots"><div class="wrap"><div class="section-heading"><p class="eyebrow">${c.lang === "en" ? "A CLOSER LOOK" : "看看真实界面"}</p><h2>${c.galleryTitle}</h2><p>${c.galleryIntro}</p></div><div class="two-columns">${c.shots.map(([name, title, text]) => `<article class="feature-shot"><a class="image-link" href="${p}assets/${c.images[name]}" target="_blank" rel="noopener" aria-label="${esc(title)}">${shot(name, text)}</a><h3>${title}</h3><p>${text}</p></article>`).join("")}</div></div></section>
<section class="wrap trust"><div class="section-heading"><h2>${c.trustTitle}</h2></div><div class="three-columns">${c.trusts.map(([title, text]) => `<article><h3>${title}</h3><p>${text}</p></article>`).join("")}</div></section>
<section class="pricing" id="get"><div class="wrap pricing-inner"><div><p class="eyebrow">${c.lang === "en" ? "MARK2 FOR MAC" : "MARK2 MAC 商店版"}</p><h2>${c.priceTitle}</h2><p class="price-lead">${c.priceLead}</p><p class="platform">${c.platform}</p></div><div class="price-box"><p class="price">${release.price}</p><p class="price-label">${c.lang === "en" ? "Planned launch price · one-time purchase" : "计划首发价 · 一次购买"}</p><p class="store-pending">${c.coming}</p><p>${c.priceNote}</p><p class="existing">${c.priceExisting}</p></div></div></section>
<section class="wrap faq"><div class="section-heading"><h2>${c.faqTitle}</h2></div><div class="faq-list">${c.faqs.map(([q, a]) => `<details><summary>${q}<span aria-hidden="true">+</span></summary><p>${a}</p></details>`).join("")}</div></section></main>
<footer class="wrap"><a class="brand" href="#">Mark2</a><p>${c.footer}</p><nav aria-label="${c.lang === "en" ? "Footer" : "页脚"}"><a href="privacy.html">${c.privacy}</a><a href="https://github.com/ywleeo/mark2" target="_blank" rel="noopener">${c.source}</a><a href="#">${c.top} ↑</a></nav><small>© 2026 Yuwei Li · Mark2</small></footer></body></html>`;
}
await mkdir("zh", { recursive: true });
await writeFile("index.html", page(copy.en));
await writeFile("zh/index.html", page(copy.zh));
console.log("Built English / and Chinese /zh/.");
