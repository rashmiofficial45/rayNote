import { Extension } from "@tiptap/react";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

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
        ({ editor, tr, dispatch }: { editor: any; tr: any; dispatch: any }) => {
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
        ({ editor, tr, dispatch }: { editor: any; tr: any; dispatch: any }) => {
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
        ({ editor, tr, dispatch }: { editor: any; tr: any; dispatch: any }) => {
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
        ({ tr, dispatch }: { tr: any; dispatch: any }) => {
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
        ({ editor }: { editor: any }) => {
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
        ({ editor }: { editor: any }) => {
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
    } as any;
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
          apply(tr, _oldSet, _oldState, newState) {
            const { searchTerm, currentIndex } = extension.storage;
            if (!searchTerm || !searchTerm.trim()) {
              return DecorationSet.empty;
            }

            if (tr.docChanged) {
              extension.storage.results = findMatches(newState.doc, searchTerm);
              if (extension.storage.currentIndex >= extension.storage.results.length) {
                extension.storage.currentIndex = 0;
              }
            }

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
          },
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

function findMatches(doc: any, term: string): SearchMatch[] {
  if (!term || !term.trim()) return [];
  const matches: SearchMatch[] = [];
  const lowerTerm = term.toLowerCase();

  doc.descendants((node: any, pos: number) => {
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
