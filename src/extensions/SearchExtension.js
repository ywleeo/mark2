import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const searchPluginKey = new PluginKey('search');

// 搜索匹配函数
function findMatches(doc, searchTerm, caseSensitive) {
    if (!searchTerm) return [];

    const results = [];
    const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    doc.descendants((node, pos) => {
        if (node.isText) {
            const text = node.text;
            // 每次都创建新的正则表达式，避免 lastIndex 问题
            const searchRegex = new RegExp(escapedTerm, caseSensitive ? 'g' : 'gi');
            let match;

            while ((match = searchRegex.exec(text)) !== null) {
                const from = pos + match.index;
                const to = from + match[0].length;
                results.push({ from, to });
            }
        }
    });

    return results;
}

export const SearchExtension = Extension.create({
    name: 'search',

    addOptions() {
        return {
            searchTerm: '',
            caseSensitive: false,
            searchResultClass: 'search-result',
            searchResultCurrentClass: 'search-result-current',
        };
    },

    addProseMirrorPlugins() {
        const { searchResultClass, searchResultCurrentClass } = this.options;

        return [
            new Plugin({
                key: searchPluginKey,
                state: {
                    init() {
                        return {
                            searchTerm: '',
                            caseSensitive: false,
                            results: [],
                            currentIndex: -1,
                        };
                    },
                    apply(tr, value) {
                        const meta = tr.getMeta(searchPluginKey);
                        if (meta) {
                            return { ...value, ...meta };
                        }
                        return value;
                    },
                },
                props: {
                    decorations(state) {
                        const { searchTerm, results, currentIndex } = searchPluginKey.getState(state);

                        if (!searchTerm || results.length === 0) {
                            return DecorationSet.empty;
                        }

                        const decorations = results.map((result, index) => {
                            const className = index === currentIndex
                                ? `${searchResultClass} ${searchResultCurrentClass}`
                                : searchResultClass;

                            return Decoration.inline(result.from, result.to, {
                                class: className,
                            });
                        });

                        return DecorationSet.create(state.doc, decorations);
                    },
                },
            }),
        ];
    },

    addCommands() {
        return {
            setSearchTerm: (searchTerm, caseSensitive = false) => ({ state, dispatch }) => {
                const results = findMatches(state.doc, searchTerm, caseSensitive);

                if (dispatch) {
                    dispatch(
                        state.tr.setMeta(searchPluginKey, {
                            searchTerm,
                            caseSensitive,
                            results,
                            currentIndex: results.length > 0 ? 0 : -1,
                        })
                    );
                }

                return true;
            },

            clearSearch: () => ({ state, dispatch }) => {
                if (dispatch) {
                    dispatch(
                        state.tr.setMeta(searchPluginKey, {
                            searchTerm: '',
                            caseSensitive: false,
                            results: [],
                            currentIndex: -1,
                        })
                    );
                }
                return true;
            },

            nextSearchResult: () => ({ state, dispatch, view }) => {
                const { results, currentIndex } = searchPluginKey.getState(state);

                if (results.length === 0) return false;

                const nextIndex = (currentIndex + 1) % results.length;

                if (dispatch) {
                    dispatch(
                        state.tr
                            .setMeta(searchPluginKey, { currentIndex: nextIndex })
                            .scrollIntoView()
                    );

                    // 滚动到当前结果
                    const result = results[nextIndex];
                    if (result && view) {
                        const dom = view.domAtPos(result.from);
                        dom.node?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
                    }
                }

                return true;
            },

            prevSearchResult: () => ({ state, dispatch, view }) => {
                const { results, currentIndex } = searchPluginKey.getState(state);

                if (results.length === 0) return false;

                const prevIndex = currentIndex <= 0 ? results.length - 1 : currentIndex - 1;

                if (dispatch) {
                    dispatch(
                        state.tr
                            .setMeta(searchPluginKey, { currentIndex: prevIndex })
                            .scrollIntoView()
                    );

                    // 滚动到当前结果
                    const result = results[prevIndex];
                    if (result && view) {
                        const dom = view.domAtPos(result.from);
                        dom.node?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
                    }
                }

                return true;
            },

            getSearchState: () => ({ state }) => {
                return searchPluginKey.getState(state);
            },
        };
    },
});
