const ROOT_PATH = 'root';
const INDENT_REM = 0.85;
const HIDDEN_CLASS = 'hidden';
const ACTIVE_CLASS = 'active';
const COMPOSITE_CLASS = 'tree-node-composite';

const state = {
  sourceName: '',
  originalData: null,
  data: null,
  selectedPath: '',
  selectedEntry: null,
  filter: '',
  treeIndex: [],
  pathLookup: new Map(),
  changedPaths: new Set(),
  collapsedPaths: new Set(),
  searchFrame: 0,
  searchDebounceTimer: 0,
  pendingFilter: '',
  treeBuilt: false,
  visibleCount: 0,
};

const refs = {
  fileInput: document.querySelector('#file-input'),
  downloadButton: document.querySelector('#download-button'),
  expandAllButton: document.querySelector('#expand-all-button'),
  collapseAllButton: document.querySelector('#collapse-all-button'),
  searchInput: document.querySelector('#search-input'),
  treeView: document.querySelector('#tree-view'),
  emptyState: document.querySelector('#empty-state'),
  searchEmpty: document.querySelector('#search-empty'),
  treeStats: document.querySelector('#tree-stats'),
  searchStatus: document.querySelector('#search-status'),
  selectionPath: document.querySelector('#selection-path'),
  dirtyIndicator: document.querySelector('#dirty-indicator'),
  editorEmpty: document.querySelector('#editor-empty'),
  editorForm: document.querySelector('#editor-form'),
  valueType: document.querySelector('#value-type'),
  valueKey: document.querySelector('#value-key'),
  textValueGroup: document.querySelector('#text-value-group'),
  textValue: document.querySelector('#text-value'),
  numberValueGroup: document.querySelector('#number-value-group'),
  numberValue: document.querySelector('#number-value'),
  booleanValueGroup: document.querySelector('#boolean-value-group'),
  booleanValue: document.querySelector('#boolean-value'),
  nullValueGroup: document.querySelector('#null-value-group'),
  compositeValueGroup: document.querySelector('#composite-value-group'),
  compositeValue: document.querySelector('#composite-value'),
  resetButton: document.querySelector('#reset-button'),
  nodeTemplate: document.querySelector('#tree-node-template'),
};

const isComposite = (value) => value !== null && typeof value === 'object';
const clone = (value) => structuredClone(value);

function describeValue(value) {
  if (Array.isArray(value)) return `Array (${value.length} items)`;
  if (value === null) return 'null';
  if (typeof value === 'object') return `Object (${Object.keys(value).length} keys)`;
  if (typeof value === 'string') return value.length ? `String · ${value}` : 'Empty string';
  return `${typeof value} · ${String(value)}`;
}

function getValueAtSegments(root, segments) {
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = current?.[segments[index]];
  }
  return current;
}

function setValueAtSegments(root, segments, nextValue) {
  const lastIndex = segments.length - 1;
  let parent = root;
  for (let index = 0; index < lastIndex; index += 1) {
    parent = parent[segments[index]];
  }
  parent[segments[lastIndex]] = nextValue;
}

function createTreeIndex(root) {
  const entries = [];
  const pathLookup = new Map();
  const stack = [{ value: root, path: ROOT_PATH, key: ROOT_PATH, depth: 0, parentIndex: -1, segments: [] }];

  while (stack.length) {
    const current = stack.pop();
    const { value, path, key, depth, parentIndex, segments } = current;
    const summary = describeValue(value);
    const entry = {
      path,
      key,
      depth,
      parentIndex,
      segments,
      isComposite: isComposite(value),
      summary,
      searchText: `${path} ${key} ${summary}`.toLowerCase(),
      wrap: null,
      element: null,
      toggle: null,
      pathLabel: null,
      summaryLabel: null,
      visible: true,
    };

    const entryIndex = entries.push(entry) - 1;
    pathLookup.set(path, entry);

    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        const childKey = String(index);
        stack.push({
          value: value[index],
          path: path === ROOT_PATH ? childKey : `${path}.${childKey}`,
          key: childKey,
          depth: depth + 1,
          parentIndex: entryIndex,
          segments: [...segments, childKey],
        });
      }
    } else if (entry.isComposite) {
      const objectEntries = Object.entries(value);
      for (let index = objectEntries.length - 1; index >= 0; index -= 1) {
        const [childKey, childValue] = objectEntries[index];
        stack.push({
          value: childValue,
          path: path === ROOT_PATH ? childKey : `${path}.${childKey}`,
          key: childKey,
          depth: depth + 1,
          parentIndex: entryIndex,
          segments: [...segments, childKey],
        });
      }
    }
  }

  return { entries, pathLookup };
}

function buildTreeDom() {
  refs.treeView.textContent = '';

  if (state.data === null) {
    refs.emptyState.classList.remove(HIDDEN_CLASS);
    state.treeBuilt = false;
    return;
  }

  refs.emptyState.classList.add(HIDDEN_CLASS);
  const fragment = document.createDocumentFragment();
  const templateRoot = refs.nodeTemplate.content.firstElementChild;
  const entries = state.treeIndex;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const wrap = templateRoot.cloneNode(true);
    const toggle = wrap.querySelector('.tree-toggle');
    const node = wrap.querySelector('.tree-node');
    const pathLabel = wrap.querySelector('.tree-node-path');
    const summaryLabel = wrap.querySelector('.tree-node-summary');

    wrap.dataset.index = String(index);
    wrap.style.setProperty('--tree-indent', `${entry.depth * INDENT_REM}rem`);
    if (entry.isComposite) node.classList.add(COMPOSITE_CLASS);

    pathLabel.textContent = entry.path;
    summaryLabel.textContent = entry.summary;

    if (entry.isComposite) {
      toggle.classList.remove(HIDDEN_CLASS);
    }

    entry.wrap = wrap;
    entry.element = node;
    entry.toggle = toggle;
    entry.pathLabel = pathLabel;
    entry.summaryLabel = summaryLabel;
    entry.visible = true;

    fragment.appendChild(wrap);
  }

  refs.treeView.appendChild(fragment);
  state.treeBuilt = true;
}

function refreshPathMetadata(entry) {
  if (!entry || state.data === null) return;
  const value = getValueAtSegments(state.data, entry.segments);
  const summary = describeValue(value);
  entry.summary = summary;
  entry.searchText = `${entry.path} ${entry.key} ${summary}`.toLowerCase();
  if (entry.summaryLabel) {
    entry.summaryLabel.textContent = summary;
  }
}

function refreshAncestorMetadata(entry) {
  let current = entry;
  while (current) {
    refreshPathMetadata(current);
    current = current.parentIndex === -1 ? null : state.treeIndex[current.parentIndex];
  }
}

function revealDescendants(startIndex, entries, visible) {
  const startDepth = entries[startIndex].depth;
  for (let index = startIndex + 1; index < entries.length; index += 1) {
    if (entries[index].depth <= startDepth) break;
    visible[index] = 1;
  }
}

function applyCollapsedState() {
  const hasFilter = Boolean(state.filter);

  for (let index = 0; index < state.treeIndex.length; index += 1) {
    const entry = state.treeIndex[index];
    if (entry.toggle) {
      const collapsed = state.collapsedPaths.has(entry.path);
      entry.toggle.setAttribute('aria-expanded', String(!collapsed));
      entry.wrap.classList.toggle('collapsed', collapsed);
      entry.toggle.disabled = hasFilter;
    }
  }
}

function applyTreeFilter() {
  if (!state.treeBuilt) return;

  const filter = state.filter;
  const entries = state.treeIndex;
  const length = entries.length;
  const visible = new Uint8Array(length);

  if (!filter) {
    visible.fill(1);
    for (let index = 0; index < length; index += 1) {
      let currentIndex = entries[index].parentIndex;
      while (currentIndex !== -1) {
        if (state.collapsedPaths.has(entries[currentIndex].path)) {
          visible[index] = 0;
          break;
        }
        currentIndex = entries[currentIndex].parentIndex;
      }
    }
  } else {
    visible[0] = 1;
    for (let index = 0; index < length; index += 1) {
      if (!entries[index].searchText.includes(filter)) continue;
      visible[index] = 1;
      if (entries[index].isComposite) {
        revealDescendants(index, entries, visible);
      }
      let currentIndex = entries[index].parentIndex;
      while (currentIndex !== -1 && visible[currentIndex] === 0) {
        visible[currentIndex] = 1;
        currentIndex = entries[currentIndex].parentIndex;
      }
    }
  }

  let visibleCount = 0;
  for (let index = 0; index < length; index += 1) {
    const entry = entries[index];
    const nextVisible = visible[index] === 1;
    if (nextVisible) visibleCount += 1;
    if (entry.visible !== nextVisible) {
      entry.visible = nextVisible;
      entry.wrap.classList.toggle(HIDDEN_CLASS, !nextVisible);
    }
  }

  state.visibleCount = visibleCount;
  refs.searchEmpty.classList.toggle(HIDDEN_CLASS, !(filter && visibleCount <= 1));
  applyCollapsedState();
}

function updateActiveNode() {
  const previous = state.selectedEntry;
  const next = state.pathLookup.get(state.selectedPath) ?? null;

  if (previous?.element) {
    previous.element.classList.remove(ACTIVE_CLASS);
  }
  if (next?.element) {
    next.element.classList.add(ACTIVE_CLASS);
  }

  state.selectedEntry = next;
}

function renderTree() {
  if (!state.treeBuilt) {
    buildTreeDom();
  }
  applyTreeFilter();
  updateActiveNode();
}

function setEditorGroups(type) {
  refs.textValueGroup.classList.toggle(HIDDEN_CLASS, type !== 'string');
  refs.numberValueGroup.classList.toggle(HIDDEN_CLASS, type !== 'number');
  refs.booleanValueGroup.classList.toggle(HIDDEN_CLASS, type !== 'boolean');
  refs.nullValueGroup.classList.toggle(HIDDEN_CLASS, type !== 'null');
  refs.compositeValueGroup.classList.toggle(HIDDEN_CLASS, type === 'string' || type === 'number' || type === 'boolean' || type === 'null');
}

function renderEditor() {
  if (state.data === null || !state.selectedPath) {
    refs.editorEmpty.classList.remove(HIDDEN_CLASS);
    refs.editorForm.classList.add(HIDDEN_CLASS);
    refs.selectionPath.textContent = 'No field selected';
    return;
  }

  refs.editorEmpty.classList.add(HIDDEN_CLASS);
  refs.editorForm.classList.remove(HIDDEN_CLASS);

  const entry = state.pathLookup.get(state.selectedPath);
  const value = getValueAtSegments(state.data, entry.segments);
  const originalValue = getValueAtSegments(state.originalData, entry.segments);
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;

  refs.selectionPath.textContent = entry.path;
  refs.valueType.value = type;
  refs.valueKey.value = entry.key;
  setEditorGroups(type);

  if (type === 'string') {
    refs.textValue.value = value;
  } else if (type === 'number') {
    refs.numberValue.value = value;
  } else if (type === 'boolean') {
    refs.booleanValue.value = String(value);
  } else if (type === 'array' || type === 'object') {
    refs.compositeValue.value = JSON.stringify(value, null, 2);
  }

  const changed = JSON.stringify(value) !== JSON.stringify(originalValue);
  refs.resetButton.disabled = !changed || entry.path === ROOT_PATH;
}

function renderTreeStats() {
  if (state.data === null) {
    refs.treeStats.textContent = 'No file loaded';
    refs.searchStatus.textContent = 'Showing all nodes';
    refs.searchEmpty.classList.add(HIDDEN_CLASS);
    return;
  }

  const collapsedCount = state.collapsedPaths.size;
  refs.treeStats.textContent = `${state.treeIndex.length} nodes indexed${collapsedCount ? ` · ${collapsedCount} collapsed` : ''}`;
  if (!state.filter) {
    refs.searchStatus.textContent = state.collapsedPaths.size ? `Showing ${state.visibleCount} visible nodes` : 'Showing all nodes';
  } else if (state.visibleCount <= 1) {
    refs.searchStatus.textContent = `No matches for “${state.filter}”`;
  } else {
    refs.searchStatus.textContent = `Filtered to ${state.visibleCount} visible nodes`;
  }
}

function renderDirtyState() {
  const dirty = state.changedPaths.size > 0;
  refs.dirtyIndicator.textContent = dirty ? 'Unsaved changes' : 'Saved';
  refs.dirtyIndicator.style.background = dirty ? '#fff4db' : '#eaf7ef';
  refs.dirtyIndicator.style.color = dirty ? '#8a5a00' : '#0f9d58';
  refs.downloadButton.disabled = state.data === null;
  refs.expandAllButton.disabled = state.data === null || state.filter.length > 0;
  refs.collapseAllButton.disabled = state.data === null || state.filter.length > 0;
}

function render() {
  renderTree();
  renderEditor();
  renderTreeStats();
  renderDirtyState();
}

function scheduleTreeRender() {
  if (state.searchFrame) {
    cancelAnimationFrame(state.searchFrame);
  }

  state.searchFrame = requestAnimationFrame(() => {
    state.searchFrame = 0;
    renderTree();
    renderTreeStats();
    renderDirtyState();
  });
}

refs.treeView.addEventListener('click', (event) => {
  const toggle = event.target.closest('.tree-toggle');
  if (toggle) {
    const wrap = toggle.closest('.tree-node-wrap');
    const entry = state.treeIndex[Number(wrap?.dataset.index)];
    if (!entry || !entry.isComposite || state.filter) return;

    if (state.collapsedPaths.has(entry.path)) {
      state.collapsedPaths.delete(entry.path);
    } else {
      state.collapsedPaths.add(entry.path);
    }

    renderTree();
    renderTreeStats();
    renderDirtyState();
    return;
  }

  const node = event.target.closest('.tree-node');
  if (!node) return;

  const wrap = node.closest('.tree-node-wrap');
  const entry = state.treeIndex[Number(wrap?.dataset.index)];
  if (!entry || state.selectedPath === entry.path) return;

  state.selectedPath = entry.path;
  render();
});

refs.fileInput.addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (!file) return;

  try {
    const text = await file.text();
    state.sourceName = file.name;
    state.originalData = JSON.parse(text);
    state.data = clone(state.originalData);
    state.selectedPath = ROOT_PATH;
    state.selectedEntry = null;
    state.collapsedPaths.clear();
    if (state.searchDebounceTimer) {
      clearTimeout(state.searchDebounceTimer);
      state.searchDebounceTimer = 0;
    }
    state.pendingFilter = refs.searchInput.value.trim().toLowerCase();
    state.filter = state.pendingFilter;
    state.changedPaths.clear();

    const { entries, pathLookup } = createTreeIndex(state.data);
    state.treeIndex = entries;
    state.pathLookup = pathLookup;
    state.treeBuilt = false;

    render();
  } catch (error) {
    alert(`Could not parse JSON: ${error.message}`);
  }
});

function queueTreeFilter(value) {
  state.pendingFilter = value.trim().toLowerCase();

  if (state.searchDebounceTimer) {
    clearTimeout(state.searchDebounceTimer);
  }

  state.searchDebounceTimer = window.setTimeout(() => {
    state.searchDebounceTimer = 0;
    state.filter = state.pendingFilter;
    scheduleTreeRender();
  }, 120);
}

refs.searchInput.addEventListener('input', (event) => {
  queueTreeFilter(event.target.value);
});

refs.expandAllButton.addEventListener('click', () => {
  state.collapsedPaths.clear();
  renderTree();
  renderTreeStats();
  renderDirtyState();
});

refs.collapseAllButton.addEventListener('click', () => {
  state.collapsedPaths = new Set(
    state.treeIndex
      .filter((entry) => entry.isComposite && entry.path !== ROOT_PATH)
      .map((entry) => entry.path),
  );
  renderTree();
  renderTreeStats();
  renderDirtyState();
});

refs.editorForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const entry = state.pathLookup.get(state.selectedPath);
  if (!entry || entry.path === ROOT_PATH) return;

  const currentValue = getValueAtSegments(state.data, entry.segments);
  let nextValue = currentValue;

  if (typeof currentValue === 'string') {
    nextValue = refs.textValue.value;
  } else if (typeof currentValue === 'number') {
    nextValue = Number(refs.numberValue.value);
  } else if (typeof currentValue === 'boolean') {
    nextValue = refs.booleanValue.value === 'true';
  } else {
    return;
  }

  setValueAtSegments(state.data, entry.segments, nextValue);

  const originalValue = getValueAtSegments(state.originalData, entry.segments);
  if (JSON.stringify(nextValue) === JSON.stringify(originalValue)) {
    state.changedPaths.delete(entry.path);
  } else {
    state.changedPaths.add(entry.path);
  }

  refreshAncestorMetadata(entry);
  render();
});

refs.resetButton.addEventListener('click', () => {
  const entry = state.pathLookup.get(state.selectedPath);
  if (!entry || entry.path === ROOT_PATH) return;

  const originalValue = clone(getValueAtSegments(state.originalData, entry.segments));
  setValueAtSegments(state.data, entry.segments, originalValue);
  state.changedPaths.delete(entry.path);
  refreshAncestorMetadata(entry);
  render();
});

refs.downloadButton.addEventListener('click', () => {
  if (state.data === null) return;

  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = state.sourceName.replace(/\.json$/i, '') + '-edited.json';
  anchor.click();
  URL.revokeObjectURL(url);
});

render();
