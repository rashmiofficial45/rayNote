import { Extension, CommandProps } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
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
    return {
      setSearchTerm:
        (term: string) =>
        ({ editor, tr, dispatch }: CommandProps) => {
          this.storage.searchTerm = term;
          this.storage.currentIndex = 0;
          this.storage.results = findMatches(editor.state.doc, term);

          if (this.storage.results.length > 0) {
            const match = this.storage.results[0];
            editor.commands.setTextSelection({ from: match.from, to: match.to });
            editor.commands.scrollIntoView();
          }

          if (dispatch) {
            tr.setMeta(searchPluginKey, { update: true });
          }
          return true;
        },

      nextSearchResult:
        () =>
        ({ editor, tr, dispatch }: CommandProps) => {
          const results = this.storage.results;
          if (results.length === 0) return false;
          this.storage.currentIndex = (this.storage.currentIndex + 1) % results.length;
          const match = results[this.storage.currentIndex];

          if (dispatch) {
            tr.setMeta(searchPluginKey, { update: true });
          }
          editor.commands.setTextSelection({ from: match.from, to: match.to });
          editor.commands.scrollIntoView();
          return true;
        },

      previousSearchResult:
        () =>
        ({ editor, tr, dispatch }: CommandProps) => {
          const results = this.storage.results;
          if (results.length === 0) return false;
          this.storage.currentIndex =
            (this.storage.currentIndex - 1 + results.length) % results.length;
          const match = results[this.storage.currentIndex];

          if (dispatch) {
            tr.setMeta(searchPluginKey, { update: true });
          }
          editor.commands.setTextSelection({ from: match.from, to: match.to });
          editor.commands.scrollIntoView();
          return true;
        },

      clearSearch:
        () =>
        ({ tr, dispatch }: CommandProps) => {
          this.storage.searchTerm = "";
          this.storage.currentIndex = 0;
          this.storage.results = [];
          if (dispatch) {
            tr.setMeta(searchPluginKey, { update: true });
          }
          return true;
        },

      replaceCurrentResult:
        (replacement: string) =>
        ({ editor }: CommandProps) => {
          const results = this.storage.results;
          if (results.length === 0) return false;
          const currentMatch = results[this.storage.currentIndex];
          if (!currentMatch) return false;

          editor
            .chain()
            .focus()
            .insertContentAt({ from: currentMatch.from, to: currentMatch.to }, replacement)
            .run();

          // Refresh matches after replacement
          this.storage.results = findMatches(editor.state.doc, this.storage.searchTerm);
          if (this.storage.results.length === 0) {
            this.storage.currentIndex = 0;
          } else if (this.storage.currentIndex >= this.storage.results.length) {
            this.storage.currentIndex = 0;
            const match = this.storage.results[0];
            editor.commands.setTextSelection({ from: match.from, to: match.to });
            editor.commands.scrollIntoView();
          } else {
            const match = this.storage.results[this.storage.currentIndex];
            editor.commands.setTextSelection({ from: match.from, to: match.to });
            editor.commands.scrollIntoView();
          }
          return true;
        },

      replaceAllResults:
        (replacement: string) =>
        ({ editor }: CommandProps) => {
          const results = this.storage.results;
          if (results.length === 0) return false;

          // Replace backwards to avoid position shift
          const chain = editor.chain().focus();
          for (let i = results.length - 1; i >= 0; i--) {
            const match = results[i];
            chain.insertContentAt({ from: match.from, to: match.to }, replacement);
          }
          chain.run();

          this.storage.results = findMatches(editor.state.doc, this.storage.searchTerm);
          this.storage.currentIndex = 0;
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
            if (tr.docChanged) {
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
  const lowerTerm = term.toLowerCase();

  doc.descendants((node: ProseMirrorNode, pos: number) => {
    if (node.isText && node.text) {
      const text = node.text.toLowerCase();
      let index = text.indexOf(lowerTerm);
      while (index !== -1) {
        matches.push({
          from: pos + index,
          to: pos + index + term.length,
        });
        index = text.indexOf(lowerTerm, index + 1);
      }
    }
  });

  return matches;
}
