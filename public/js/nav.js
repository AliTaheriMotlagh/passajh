// Hooks the app shell fills in, so pages can ask for a re-render or a tab-bar update without importing
// the shell (which imports them).

export const nav = {
  refresh() {},
  listCount() {},
};
