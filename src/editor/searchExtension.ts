import { Extension, CommandProps } from "@tiptap/react";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Node as ProseMirrorNode } from "@tiptap/pm/model";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    search: {
      setSearchTerm: (term: string) => ReturnType;
      nextSearchResult: () => ReturnType;
      previousSearchResult: () => ReturnType;
      clearSearch: () => ReturnType;
      replaceCurrentResult: (replacement: string) => ReturnType;
      replaceAllResults: (replacement: string) => ReturnType;
    };
  }
}

export interface SearchMatch {
  from: number;
  to: number;
}

export interface SearchStorage {
  searchTerm: string;
  currentIndex: number;
  results: SearchMatch[];
}

export const searchPluginKey = new PluginKey("searchPlugin");

export const SearchExtension = Extension.create<Record<string, never>, SearchStorage>({
  name: "search",

  addStorage() {
    return {
      searchTerm: "",
      currentIndex: 0,
      results: [],
    };
  },

  addCommands() {
    const update = (tr: CommandProps["tr"], results: SearchMatch[], index: number) => {
      this.storage.results = results;
      this.storage.currentIndex = results.length ? index % results.length : 0;
      const match = results[this.storage.currentIndex];
      if (match) {
        tr.setSelection(TextSelection.create(tr.doc, match.from, match.to));
        tr.scrollIntoView();
      }
      tr.setMeta(searchPluginKey, { update: true });
    };
    const navigate = (step: number) => ({ tr, dispatch }: CommandProps) => {
      const results = findMatches(tr.doc, this.storage.searchTerm);
      if (!results.length) return false;
      if (dispatch) {
        const index = (this.storage.currentIndex + step + results.length) % results.length;
        update(tr, results, index);
      }
      return true;
    };
    return {
      setSearchTerm: (term: string) => ({ tr, dispatch }: CommandProps) => {
        if (dispatch) {
          this.storage.searchTerm = term;
          update(tr, findMatches(tr.doc, term), 0);
        }
        return true;
      },
      nextSearchResult: () => navigate(1),
      previousSearchResult: () => navigate(-1),
      clearSearch: () => ({ tr, dispatch }: CommandProps) => {
        if (dispatch) {
          this.storage.searchTerm = "";
          update(tr, [], 0);
        }
        return true;
      },
      replaceCurrentResult: (replacement: string) => ({ tr, dispatch }: CommandProps) => {
        // The view's rescan is debounced while typing; destructive commands must use fresh offsets.
        const results = findMatches(tr.doc, this.storage.searchTerm);
        if (!results.length) return false;
        if (dispatch) {
          const index = Math.min(this.storage.currentIndex, results.length - 1);
          const match = results[index];
          tr.insertText(replacement, match.from, match.to);
          update(tr, findMatches(tr.doc, this.storage.searchTerm), index);
        }
        return true;
      },
      replaceAllResults: (replacement: string) => ({ tr, dispatch }: CommandProps) => {
        const results = findMatches(tr.doc, this.storage.searchTerm);
        if (!results.length) return false;
        if (dispatch) {
          for (let i = results.length - 1; i >= 0; i--) {
            tr.insertText(replacement, results[i].from, results[i].to);
          }
          update(tr, findMatches(tr.doc, this.storage.searchTerm), 0);
        }
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const extension = this;
    return [
      new Plugin({
        key: searchPluginKey,
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr, oldSet, _oldState, newState) {
            const { searchTerm, currentIndex } = extension.storage;
            // Inactive search: return DecorationSet.empty in O(1)
            if (!searchTerm || !searchTerm.trim()) {
              return DecorationSet.empty;
            }

            const meta = tr.getMeta(searchPluginKey);

            // Document changed while search is active: pure O(1) decoration mapping
            if (tr.docChanged && !meta?.update) {
              return oldSet.map(tr.mapping, tr.doc);
            }

            // Explicit search update (query change, next/prev navigation, or debounced rescan dispatch)
            if (meta?.update) {
              const results = extension.storage.results;
              if (results.length === 0) {
                return DecorationSet.empty;
              }

              const decorations: Decoration[] = [];
              results.forEach((match: SearchMatch, idx: number) => {
                const isCurrent = idx === currentIndex;
                decorations.push(
                  Decoration.inline(match.from, match.to, {
                    class: isCurrent ? "search-match search-match-active" : "search-match",
                  })
                );
              });

              return DecorationSet.create(newState.doc, decorations);
            }

            return oldSet;
          },
        },
        view() {
          let debounceTimer: ReturnType<typeof setTimeout> | null = null;

          return {
            update(view, prevState) {
              const term = extension.storage.searchTerm;
              if (!term || !term.trim()) {
                if (debounceTimer) {
                  clearTimeout(debounceTimer);
                  debounceTimer = null;
                }
                return;
              }

              // When document changes during active search, debounce full match re-scan by ~150ms in plugin view
              if (view.state.doc !== prevState.doc) {
                if (debounceTimer) {
                  clearTimeout(debounceTimer);
                }
                debounceTimer = setTimeout(() => {
                  if (!view.isDestroyed) {
                    const currentTerm = extension.storage.searchTerm;
                    if (currentTerm && currentTerm.trim()) {
                      extension.storage.results = findMatches(view.state.doc, currentTerm);
                      if (extension.storage.currentIndex >= extension.storage.results.length) {
                        extension.storage.currentIndex = 0;
                      }
                      view.dispatch(view.state.tr.setMeta(searchPluginKey, { update: true }));
                    }
                  }
                }, 150);
              }
            },
            destroy() {
              if (debounceTimer) {
                clearTimeout(debounceTimer);
                debounceTimer = null;
              }
            },
          };
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

function findMatches(doc: ProseMirrorNode, term: string): SearchMatch[] {
  if (!term || !term.trim()) return [];
  const matches: SearchMatch[] = [];
  // Match contiguous text across marks, without joining across blocks or inline atoms.
  // RegExp match offsets refer to the original string even when case folding changes its length.
  const pattern = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  doc.descendants((node: ProseMirrorNode, pos: number) => {
    if (!node.isTextblock) return;
    let text = "";
    let start = pos + 1;
    const collect = () => {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text))) {
        matches.push({ from: start + match.index, to: start + match.index + match[0].length });
      }
      text = "";
    };
    node.forEach((child, offset) => {
      if (child.isText) {
        if (!text) start = pos + 1 + offset;
        text += child.text;
      } else {
        collect();
      }
    });
    collect();
    return false;
  });
  return matches;
}
