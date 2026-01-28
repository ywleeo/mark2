/**
 * 视图容器设置
 * 负责创建和初始化所有视图面板
 */

import { requireElementById, requireElementWithin } from './domHelpers.js';

/**
 * 初始化主视图容器和所有视图面板
 * @param {AppState} appState - 应用状态实例
 */
export function setupViewPanes(appState) {
    const viewContainer = requireElementById('viewContent', '未找到视图容器 viewContent');
    appState.setPaneElement('viewContainer', viewContainer);

    // 创建所有视图面板
    viewContainer.innerHTML = `
        <div class="view-pane markdown-pane is-active" data-pane="markdown"></div>
        <div class="view-pane code-pane" data-pane="code"></div>
        <div class="view-pane image-pane" data-pane="image"></div>
        <div class="view-pane media-pane" data-pane="media"></div>
        <div class="view-pane spreadsheet-pane" data-pane="spreadsheet"></div>
        <div class="view-pane pdf-pane" data-pane="pdf"></div>
        <div class="view-pane html-pane" data-pane="html"></div>
        <div class="view-pane workflow-pane" data-pane="workflow"></div>
        <div class="view-pane unsupported-pane" data-pane="unsupported"></div>
    `;

    // 注册所有面板元素到 AppState
    appState.setPaneElement('markdown', requireElementWithin(viewContainer, '.markdown-pane', '视图容器缺少 markdown-pane'));
    appState.setPaneElement('code', requireElementWithin(viewContainer, '.code-pane', '视图容器缺少 code-pane'));
    appState.setPaneElement('image', requireElementWithin(viewContainer, '.image-pane', '视图容器缺少 image-pane'));
    appState.setPaneElement('media', requireElementWithin(viewContainer, '.media-pane', '视图容器缺少 media-pane'));
    appState.setPaneElement('spreadsheet', requireElementWithin(viewContainer, '.spreadsheet-pane', '视图容器缺少 spreadsheet-pane'));
    appState.setPaneElement('pdf', requireElementWithin(viewContainer, '.pdf-pane', '视图容器缺少 pdf-pane'));
    appState.setPaneElement('html', requireElementWithin(viewContainer, '.html-pane', '视图容器缺少 html-pane'));
    appState.setPaneElement('workflow', requireElementWithin(viewContainer, '.workflow-pane', '视图容器缺少 workflow-pane'));
    appState.setPaneElement('unsupported', requireElementWithin(viewContainer, '.unsupported-pane', '视图容器缺少 unsupported-pane'));
}
