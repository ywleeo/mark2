import { CardExportFlow } from './CardExportFlow.js';

/**
 * 初始化卡片导出功能。
 * AI 写作与全文排版统一由 Markdown Toolbar 提供，不再注册编辑器右键菜单。
 * @returns {{open: Function, hide: Function, destroy: Function}} 卡片导出 API。
 */
export function initCardExport() {
    const flow = new CardExportFlow();
    flow.mount();

    return {
        open: ({ text, html }) => flow.open({ text, html }),
        hide: () => flow.hide(),
        destroy: () => flow.destroy(),
    };
}
