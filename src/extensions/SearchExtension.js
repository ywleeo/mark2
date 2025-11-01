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
                        let nextState = value;

                        if (meta) {
                            nextState = { ...value, ...meta };
                        }

                        if (tr.docChanged) {
                            const searchTerm = nextState.searchTerm;
                            if (!searchTerm) {
                                if (nextState.results.length !== 0 || nextState.currentIndex !== -1) {
                                    nextState = {
                                        ...nextState,
                                        results: [],
                                        currentIndex: -1,
                                    };
                                }
                                return nextState;
                            }

                            const previousResults = meta?.results ?? value.results;
                            const previousIndex = meta?.currentIndex ?? value.currentIndex;
                            const updatedResults = findMatches(tr.doc, searchTerm, nextState.caseSensitive);

                            let currentIndex = previousIndex;
                            if (updatedResults.length === 0) {
                                currentIndex = -1;
                            } else if (currentIndex >= 0) {
                                const previousMatch = previousResults?.[previousIndex] ?? null;
                                if (previousMatch) {
                                    const matchIndex = updatedResults.findIndex(result => {
                                        return result.from === previousMatch.from && result.to === previousMatch.to;
                                    });
                                    if (matchIndex !== -1) {
                                        currentIndex = matchIndex;
                                    } else if (currentIndex >= updatedResults.length) {
                                        currentIndex = updatedResults.length - 1;
                                    }
                                } else if (currentIndex >= updatedResults.length) {
                                    currentIndex = updatedResults.length - 1;
                                }
                            }

                            if (currentIndex < 0 && updatedResults.length > 0) {
                                currentIndex = 0;
                            }

                            nextState = {
                                ...nextState,
                                results: updatedResults,
                                currentIndex,
                            };
                        }

                        return nextState;
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
