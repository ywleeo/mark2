import { Extension } from '@tiptap/core';

// Prevent ProseMirror from wrapping the current selection in inline code when pressing Cmd/Ctrl+E.
export const DisableInlineCodeShortcut = Extension.create({
    name: 'disableInlineCodeShortcut',
    priority: 1000,

    addKeyboardShortcuts() {
        return {
            'Mod-e': () => true,
        };
    },
});
