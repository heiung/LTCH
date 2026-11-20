// Stores bounded snapshots; an edit after undo discards the abandoned future.
export function createQuestionHistory(initial, limit = 50) {
  if (!initial || !Number.isInteger(limit) || limit < 2) throw new TypeError('Invalid history configuration');
  const states = [initial]; let index = 0;
  return {
    get current() { return states[index]; },
    get canUndo() { return index > 0; },
    get canRedo() { return index < states.length - 1; },
    replaceCurrent(state) { if (state.markup === states[index].markup) states[index] = state; },
    commit(state) {
      if (state.markup === states[index].markup) return false;
      states.splice(index + 1); states.push(state);
      if (states.length > limit) states.shift();
      index = states.length - 1; return true;
    },
    undo() { if (index > 0) index--; return states[index]; },
    redo() { if (index < states.length - 1) index++; return states[index]; }
  };
}
