import { createCardSidebarLayoutService } from './layoutService.js';
import { CardSidebar } from './CardSidebar.js';

export async function initCardExportSidebar() {
    const layoutService = createCardSidebarLayoutService();
    const cardSidebar = new CardSidebar({ layoutService });
    const sidebarElement = cardSidebar.render();
    const searchBox = document.querySelector('.search-box');
    if (searchBox?.parentNode) {
        searchBox.parentNode.insertBefore(sidebarElement, searchBox);
    } else {
        document.body.appendChild(sidebarElement);
    }

    return {
        showSidebar: () => cardSidebar.show(),
        hideSidebar: () => cardSidebar.hide(),
        toggleSidebar: () => cardSidebar.toggle(),
        layoutService,
        destroy: () => cardSidebar.destroy(),
    };
}
