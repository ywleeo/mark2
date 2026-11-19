/** Build independent English and Chinese pages from shared structure and localized product copy. */
import { mkdir, writeFile } from "node:fs/promises";
const base = "https://ywleeo.github.io/mark2/";
const release = { price: "US$14.99" };
const copy = {
  en: {
    lang: "en",
    prefix: "../",
    other: "../",
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
  const url = base + (c.lang === "en" ? "en/" : "");
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
<html lang="${c.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.title)}</title><meta name="description" content="${esc(c.description)}"><meta name="theme-color" content="#faf8f3"><link rel="canonical" href="${url}"><link rel="alternate" hreflang="en" href="${base}en/"><link rel="alternate" hreflang="zh-Hans" href="${base}"><link rel="alternate" hreflang="x-default" href="${base}en/"><link rel="icon" type="image/svg+xml" href="${p}assets/logo.svg"><meta property="og:title" content="${esc(c.title)}"><meta property="og:description" content="${esc(c.description)}"><meta property="og:url" content="${url}"><meta property="og:type" content="website"><meta property="og:locale" content="${c.lang === "en" ? "en_US" : "zh_CN"}"><meta property="og:image" content="${base}assets/${c.images.editorial}"><meta name="twitter:card" content="summary_large_image"><link rel="stylesheet" href="${p}assets/site.css"><script src="${p}assets/site.js" defer></script></head><body>
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
<footer class="wrap"><a class="brand" href="#">Mark2</a><p>${c.footer}</p><nav aria-label="${c.lang === "en" ? "Footer" : "页脚"}"><a href="../privacy.html">${c.privacy}</a><a href="https://github.com/ywleeo/mark2" target="_blank" rel="noopener">${c.source}</a><a href="#">${c.top} ↑</a></nav><small>© 2026 Yuwei Li · Mark2</small></footer></body></html>`;
}
await mkdir("en", { recursive: true });
await writeFile("en/index.html", page(copy.en));
console.log("Built English homepage at /en/.");
