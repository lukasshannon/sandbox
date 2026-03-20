const state = {
  sourceName: '',
  originalData: null,
  data: null,
  selectedPath: '',
  filter: '',
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

function getEntries(value) {
  if (Array.isArray(value)) {
    return value.map((item, index) => [String(index), item]);
  }
  if (isComposite(value)) {
    return Object.entries(value);
  }
  return [];
}

function getValueAtPath(root, path) {
  if (!path) return root;
  return path.split('.').reduce((current, segment) => current?.[segment], root);
}

function setValueAtPath(root, path, nextValue) {
  const parts = path.split('.');
  const leaf = parts.pop();
  const parent = parts.reduce((current, segment) => current[segment], root);
  parent[leaf] = nextValue;
}

function matchesFilter(path, key, value) {
  if (!state.filter) return true;
  const haystack = `${path} ${key} ${describeValue(value)}`.toLowerCase();
  return haystack.includes(state.filter);
}

function renderTree() {
  refs.treeView.innerHTML = '';

  if (state.data === null) {
    refs.emptyState.classList.remove('hidden');
    return;
  }

  refs.emptyState.classList.add('hidden');
  const fragment = document.createDocumentFragment();
  fragment.appendChild(buildTreeGroup(state.data, 'root'));
  refs.treeView.appendChild(fragment);
}

function buildTreeGroup(value, path) {
  const container = document.createElement('div');
  container.className = 'tree-group';

  const node = refs.nodeTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.path = path;
  node.classList.toggle('active', path === state.selectedPath);
  node.querySelector('.tree-node-path').textContent = path;
  node.querySelector('.tree-node-summary').textContent = describeValue(value);
  node.hidden = !matchesFilter(path, path.split('.').at(-1), value);
  node.addEventListener('click', () => {
    state.selectedPath = path;
    render();
  });
  container.appendChild(node);

  for (const [key, child] of getEntries(value)) {
    const childPath = path === 'root' ? key : `${path}.${key}`;
    const childNode = isComposite(child) ? buildTreeGroup(child, childPath) : buildTreeLeaf(child, childPath, key);
    if (!childNode.hidden) {
      container.appendChild(childNode);
    }
  }

  const visibleChildren = [...container.children].some((child) => !child.hidden);
  container.hidden = !visibleChildren;
  return container;
}

function buildTreeLeaf(value, path, key) {
  const node = refs.nodeTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.path = path;
  node.classList.toggle('active', path === state.selectedPath);
  node.querySelector('.tree-node-path').textContent = path;
  node.querySelector('.tree-node-summary').textContent = describeValue(value);
  node.hidden = !matchesFilter(path, key, value);
  node.addEventListener('click', () => {
    state.selectedPath = path;
    render();
  });
  return node;
}

function renderEditor() {
  if (state.data === null || !state.selectedPath) {
    refs.editorEmpty.classList.remove('hidden');
    refs.editorForm.classList.add('hidden');
    refs.selectionPath.textContent = 'No field selected';
    return;
  }

  refs.editorEmpty.classList.add('hidden');
  refs.editorForm.classList.remove('hidden');

  const value = getValueAtPath(state.data, state.selectedPath);
  const originalValue = getValueAtPath(state.originalData, state.selectedPath);
  const key = state.selectedPath.split('.').at(-1);
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;

  refs.selectionPath.textContent = state.selectedPath;
  refs.valueType.value = type;
  refs.valueKey.value = key;

  [refs.textValueGroup, refs.numberValueGroup, refs.booleanValueGroup, refs.nullValueGroup, refs.compositeValueGroup]
    .forEach((element) => element.classList.add('hidden'));

  if (type === 'string') {
    refs.textValueGroup.classList.remove('hidden');
    refs.textValue.value = value;
  } else if (type === 'number') {
    refs.numberValueGroup.classList.remove('hidden');
    refs.numberValue.value = value;
  } else if (type === 'boolean') {
    refs.booleanValueGroup.classList.remove('hidden');
    refs.booleanValue.value = String(value);
  } else if (type === 'null') {
    refs.nullValueGroup.classList.remove('hidden');
  } else {
    refs.compositeValueGroup.classList.remove('hidden');
    refs.compositeValue.value = JSON.stringify(value, null, 2);
  }

  const changed = JSON.stringify(value) !== JSON.stringify(originalValue);
  refs.resetButton.disabled = !changed || state.selectedPath === 'root';
}

function renderDirtyState() {
  const dirty = JSON.stringify(state.data) !== JSON.stringify(state.originalData);
  refs.dirtyIndicator.textContent = dirty ? 'Unsaved changes' : 'Saved';
  refs.dirtyIndicator.style.background = dirty ? '#fff4db' : '#eaf7ef';
  refs.dirtyIndicator.style.color = dirty ? '#8a5a00' : '#0f9d58';
  refs.downloadButton.disabled = state.data === null;
}

function render() {
  renderTree();
  renderEditor();
  renderDirtyState();
}

refs.fileInput.addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (!file) return;

  try {
    const text = await file.text();
    state.sourceName = file.name;
    state.originalData = JSON.parse(text);
    state.data = clone(state.originalData);
    state.selectedPath = 'root';
    render();
  } catch (error) {
    alert(`Could not parse JSON: ${error.message}`);
  }
});

refs.searchInput.addEventListener('input', (event) => {
  state.filter = event.target.value.trim().toLowerCase();
  renderTree();
});

refs.editorForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!state.selectedPath || state.selectedPath === 'root') return;

  const currentValue = getValueAtPath(state.data, state.selectedPath);
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

  setValueAtPath(state.data, state.selectedPath, nextValue);
  render();
});

refs.resetButton.addEventListener('click', () => {
  if (!state.selectedPath || state.selectedPath === 'root') return;
  const originalValue = clone(getValueAtPath(state.originalData, state.selectedPath));
  setValueAtPath(state.data, state.selectedPath, originalValue);
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
