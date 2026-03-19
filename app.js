const state = {
  sourceName: '',
  originalData: null,
  data: null,
  selectedId: null,
  filter: '',
  index: {
    nodes: [],
    byId: new Map(),
    visibleIds: [],
    expanded: new Set(),
    selectedElement: null,
  },
  dirtyPaths: new Set(),
};

const refs = {
  fileInput: document.querySelector('#file-input'),
  downloadButton: document.querySelector('#download-button'),
  searchInput: document.querySelector('#search-input'),
  treeView: document.querySelector('#tree-view'),
  emptyState: document.querySelector('#empty-state'),
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
};

const hiddenGroups = [
  refs.textValueGroup,
  refs.numberValueGroup,
  refs.booleanValueGroup,
  refs.nullValueGroup,
  refs.compositeValueGroup,
];

const isComposite = (value) => value !== null && typeof value === 'object';
const clone = (value) => structuredClone(value);

function describeValue(value) {
  if (Array.isArray(value)) return `Array (${value.length} items)`;
  if (value === null) return 'null';
  if (typeof value === 'object') return `Object (${Object.keys(value).length} keys)`;
  if (typeof value === 'string') {
    const preview = value.length > 80 ? `${value.slice(0, 77)}…` : value;
    return value.length ? `String · ${preview}` : 'Empty string';
  }
  return `${typeof value} · ${String(value)}`;
}

function createNode({ id, parentId, key, depth, value, pathSegments }) {
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
  const pathLabel = id === 0 ? 'root' : pathSegments.join(' › ');
  const searchKey = key === null ? 'root' : String(key);

  return {
    id,
    parentId,
    key,
    depth,
    type,
    pathSegments,
    pathLabel,
    summary: describeValue(value),
    searchText: `${pathLabel} ${searchKey} ${type} ${describeValue(value)}`.toLowerCase(),
    childIds: [],
    composite: isComposite(value),
  };
}

function buildIndex(root) {
  const nodes = [];
  const byId = new Map();
  const expanded = new Set([0]);
  let idCounter = 0;

  const rootNode = createNode({
    id: idCounter++,
    parentId: null,
    key: null,
    depth: 0,
    value: root,
    pathSegments: [],
  });

  nodes.push(rootNode);
  byId.set(rootNode.id, rootNode);

  const stack = [{ value: root, node: rootNode }];

  while (stack.length) {
    const current = stack.pop();
    if (!current.node.composite) continue;

    const entries = Array.isArray(current.value)
      ? current.value.map((item, index) => [index, item])
      : Object.entries(current.value);

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [entryKey, entryValue] = entries[index];
      const childNode = createNode({
        id: idCounter++,
        parentId: current.node.id,
        key: entryKey,
        depth: current.node.depth + 1,
        value: entryValue,
        pathSegments: current.node.pathSegments.concat(String(entryKey)),
      });

      current.node.childIds.unshift(childNode.id);
      nodes.push(childNode);
      byId.set(childNode.id, childNode);
      stack.push({ value: entryValue, node: childNode });
    }
  }

  state.index = {
    nodes,
    byId,
    visibleIds: [],
    expanded,
    selectedElement: null,
  };
}

function getNodeValue(root, node) {
  let current = root;
  for (let index = 0; index < node.pathSegments.length; index += 1) {
    current = current?.[node.pathSegments[index]];
  }
  return current;
}

function setNodeValue(root, node, nextValue) {
  if (node.id === 0) return;
  let current = root;
  for (let index = 0; index < node.pathSegments.length - 1; index += 1) {
    current = current[node.pathSegments[index]];
  }
  current[node.pathSegments.at(-1)] = nextValue;
}

function updateDirtyPath(node) {
  if (!node || node.id === 0) return;
  const currentValue = getNodeValue(state.data, node);
  const originalValue = getNodeValue(state.originalData, node);
  const key = node.pathSegments.join('\u0001');

  if (Object.is(currentValue, originalValue) || JSON.stringify(currentValue) === JSON.stringify(originalValue)) {
    state.dirtyPaths.delete(key);
  } else {
    state.dirtyPaths.add(key);
  }
}

function updateNodeMetadata(node) {
  const value = getNodeValue(state.data, node);
  node.summary = describeValue(value);
  node.searchText = `${node.pathLabel} ${node.key ?? 'root'} ${node.type} ${node.summary}`.toLowerCase();
}

function expandAncestors(nodeId) {
  let current = state.index.byId.get(nodeId);
  while (current?.parentId !== null) {
    state.index.expanded.add(current.parentId);
    current = state.index.byId.get(current.parentId);
  }
}

function computeVisibleIds() {
  const { byId, expanded } = state.index;
  const visibleIds = [];
  const filter = state.filter;
  const matches = filter
    ? new Set(state.index.nodes.filter((node) => node.searchText.includes(filter)).map((node) => node.id))
    : null;
  const included = filter ? new Set() : null;

  if (filter) {
    for (const id of matches) {
      let current = byId.get(id);
      while (current) {
        included.add(current.id);
        current = current.parentId === null ? null : byId.get(current.parentId);
      }
    }
  }

  const stack = [0];
  while (stack.length) {
    const id = stack.pop();
    const node = byId.get(id);
    if (!node) continue;
    if (included && !included.has(id)) continue;
    visibleIds.push(id);

    if (node.composite && (filter || expanded.has(id))) {
      for (let index = node.childIds.length - 1; index >= 0; index -= 1) {
        stack.push(node.childIds[index]);
      }
    }
  }

  state.index.visibleIds = visibleIds;
}

function renderTree() {
  refs.treeView.textContent = '';

  if (state.data === null) {
    refs.emptyState.classList.remove('hidden');
    return;
  }

  refs.emptyState.classList.add('hidden');
  computeVisibleIds();

  const fragment = document.createDocumentFragment();

  for (const id of state.index.visibleIds) {
    const node = state.index.byId.get(id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tree-node';
    button.dataset.nodeId = String(node.id);
    button.style.setProperty('--depth', node.depth);
    if (state.selectedId === node.id) {
      button.classList.add('active');
      state.index.selectedElement = button;
    }

    const heading = document.createElement('span');
    heading.className = 'tree-node-heading';

    const caret = document.createElement('span');
    caret.className = 'tree-caret';
    caret.textContent = node.composite ? (state.filter || state.index.expanded.has(node.id) ? '▾' : '▸') : '•';
    heading.appendChild(caret);

    const path = document.createElement('span');
    path.className = 'tree-node-path';
    path.textContent = node.pathLabel;
    heading.appendChild(path);

    const summary = document.createElement('span');
    summary.className = 'tree-node-summary';
    summary.textContent = node.summary;

    button.append(heading, summary);
    fragment.appendChild(button);
  }

  refs.treeView.appendChild(fragment);
}

function updateRenderedNode(node) {
  const button = refs.treeView.querySelector(`[data-node-id="${CSS.escape(String(node.id))}"]`);
  if (!button) return false;

  const summary = button.querySelector('.tree-node-summary');
  if (summary) summary.textContent = node.summary;

  const path = button.querySelector('.tree-node-path');
  if (path) path.textContent = node.pathLabel;

  return true;
}

function setSelectedNode(nodeId) {
  if (state.selectedId === nodeId) return;

  if (state.index.selectedElement) {
    state.index.selectedElement.classList.remove('active');
  }

  state.selectedId = nodeId;
  const nextSelectedElement = refs.treeView.querySelector(`[data-node-id="${CSS.escape(String(nodeId))}"]`);
  if (nextSelectedElement) {
    nextSelectedElement.classList.add('active');
    state.index.selectedElement = nextSelectedElement;
  } else {
    state.index.selectedElement = null;
  }

  renderEditor();
}

function renderEditor() {
  if (state.data === null || state.selectedId === null) {
    refs.editorEmpty.classList.remove('hidden');
    refs.editorForm.classList.add('hidden');
    refs.selectionPath.textContent = 'No field selected';
    refs.resetButton.disabled = true;
    return;
  }

  refs.editorEmpty.classList.add('hidden');
  refs.editorForm.classList.remove('hidden');

  const node = state.index.byId.get(state.selectedId);
  const value = getNodeValue(state.data, node);
  const originalValue = getNodeValue(state.originalData, node);

  refs.selectionPath.textContent = node.pathLabel;
  refs.valueType.value = node.type;
  refs.valueKey.value = node.id === 0 ? 'root' : String(node.key);

  hiddenGroups.forEach((element) => element.classList.add('hidden'));

  if (node.type === 'string') {
    refs.textValueGroup.classList.remove('hidden');
    refs.textValue.value = value;
  } else if (node.type === 'number') {
    refs.numberValueGroup.classList.remove('hidden');
    refs.numberValue.value = value;
  } else if (node.type === 'boolean') {
    refs.booleanValueGroup.classList.remove('hidden');
    refs.booleanValue.value = String(value);
  } else if (node.type === 'null') {
    refs.nullValueGroup.classList.remove('hidden');
  } else {
    refs.compositeValueGroup.classList.remove('hidden');
    refs.compositeValue.value = JSON.stringify(value, null, 2);
  }

  refs.resetButton.disabled = node.id === 0 || JSON.stringify(value) === JSON.stringify(originalValue);
}

function renderDirtyState() {
  const dirty = state.dirtyPaths.size > 0;
  refs.dirtyIndicator.textContent = dirty ? `Unsaved changes (${state.dirtyPaths.size})` : 'Saved';
  refs.dirtyIndicator.style.background = dirty ? '#fff4db' : '#eaf7ef';
  refs.dirtyIndicator.style.color = dirty ? '#8a5a00' : '#0f9d58';
  refs.downloadButton.disabled = state.data === null;
}

function renderAll() {
  renderTree();
  renderEditor();
  renderDirtyState();
}

function loadJsonData(parsed, sourceName) {
  state.sourceName = sourceName;
  state.originalData = parsed;
  state.data = clone(parsed);
  state.filter = '';
  state.dirtyPaths.clear();
  refs.searchInput.value = '';
  buildIndex(state.data);
  state.selectedId = 0;
  renderAll();
}

refs.fileInput.addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (!file) return;

  try {
    const parsed = JSON.parse(await file.text());
    loadJsonData(parsed, file.name);
  } catch (error) {
    alert(`Could not parse JSON: ${error.message}`);
  }
});

refs.searchInput.addEventListener('input', (event) => {
  state.filter = event.target.value.trim().toLowerCase();
  if (state.selectedId !== null) {
    expandAncestors(state.selectedId);
  }
  renderTree();
});

refs.treeView.addEventListener('click', (event) => {
  const button = event.target.closest('.tree-node');
  if (!button) return;

  const nodeId = Number(button.dataset.nodeId);
  const node = state.index.byId.get(nodeId);
  if (!node) return;

  if (node.composite && !state.filter) {
    state.index.expanded.has(nodeId)
      ? state.index.expanded.delete(nodeId)
      : state.index.expanded.add(nodeId);
    renderTree();
  }

  setSelectedNode(nodeId);
});

refs.editorForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (state.selectedId === null) return;

  const node = state.index.byId.get(state.selectedId);
  if (!node || node.id === 0) return;

  const currentValue = getNodeValue(state.data, node);
  let nextValue = currentValue;

  if (node.type === 'string') {
    nextValue = refs.textValue.value;
  } else if (node.type === 'number') {
    nextValue = Number(refs.numberValue.value);
  } else if (node.type === 'boolean') {
    nextValue = refs.booleanValue.value === 'true';
  } else {
    return;
  }

  setNodeValue(state.data, node, nextValue);
  updateDirtyPath(node);
  updateNodeMetadata(node);

  if (state.filter || !updateRenderedNode(node)) {
    renderTree();
    setSelectedNode(node.id);
  } else {
    renderEditor();
  }

  renderDirtyState();
});

refs.resetButton.addEventListener('click', () => {
  if (state.selectedId === null) return;
  const node = state.index.byId.get(state.selectedId);
  if (!node || node.id === 0) return;

  setNodeValue(state.data, node, clone(getNodeValue(state.originalData, node)));
  updateDirtyPath(node);
  updateNodeMetadata(node);

  if (state.filter || !updateRenderedNode(node)) {
    renderTree();
    setSelectedNode(node.id);
  } else {
    renderEditor();
  }

  renderDirtyState();
});

refs.downloadButton.addEventListener('click', () => {
  if (state.data === null) return;

  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${state.sourceName.replace(/\.json$/i, '') || 'data'}-edited.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});

renderAll();
