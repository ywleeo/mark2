import { CardExportFlow } from './CardExportFlow.js';
import { EditorContextMenu } from './EditorContextMenu.js';

export function initCardExport() {
    const flow = new CardExportFlow();
    flow.mount();

    const contextMenu = new EditorContextMenu({
        onGenerateCard: ({ text, html }) => flow.open({ text, html }),
    });

    return {
        open: ({ text, html }) => flow.open({ text, html }),
        hide: () => flow.hide(),
        destroy: () => {
            flow.destroy();
            contextMenu.destroy();
        },
    };
}
