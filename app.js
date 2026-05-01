const ROOT_PATH = 'root';
const INDENT_REM = 0.85;
const HIDDEN_CLASS = 'hidden';
const ACTIVE_CLASS = 'active';
const COMPOSITE_CLASS = 'tree-node-composite';
const MODIFIED_CLASS = 'tree-node-modified';
const MAX_ACTIVITY_ITEMS = 5;
const THEME_STORAGE_KEY = 'json-navigator-theme';
const SESSION_STORAGE_KEY = 'json-navigator-session-v2';
const UI_STORAGE_KEY = 'json-navigator-ui-v1';
const VALID_THEMES = new Set(['system', 'light', 'dark']);
const DEMO_DATA = {
  app: { name: 'JSON Navigator', version: 2, onboardingComplete: false },
  account: { owner: 'Taylor', alertsEnabled: true, usage: { searches: 48, lastSync: '2026-03-21T09:00:00Z' } },
  projects: [
    { id: 1, name: 'Mobile redesign', status: 'active', budget: 14500.25 },
    { id: 2, name: 'Offline support', status: 'planning', budget: 8200 },
  ],
};

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
  mobilePanel: 'structure',
  primitiveCount: 0,
  maxDepth: 0,
  activity: ['No recent activity.'],
  reviewEditedOnly: false,
  theme: 'system',
  isBusy: false,
  undoStack: [],
  onboardingDismissed: false,
  canRestoreSession: false,
};

const refs = {
  fileInput: document.querySelector('#file-input'),
  demoButton: document.querySelector('#demo-button'),
  downloadButton: document.querySelector('#download-button'),
  shareButton: document.querySelector('#share-button'),
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
  undoButton: document.querySelector('#undo-button'),
  saveButton: document.querySelector('#save-button'),
  validationMessage: document.querySelector('#validation-message'),
  nodeTemplate: document.querySelector('#tree-node-template'),
  showStructureButton: document.querySelector('#show-structure-button'),
  showEditorButton: document.querySelector('#show-editor-button'),
  fileName: document.querySelector('#file-name'),
  summaryNodes: document.querySelector('#summary-nodes'),
  summaryPrimitives: document.querySelector('#summary-primitives'),
  summaryDepth: document.querySelector('#summary-depth'),
  summaryChanges: document.querySelector('#summary-changes'),
  copyPathButton: document.querySelector('#copy-path-button'),
  clearSearchButton: document.querySelector('#clear-search-button'),
  editedOnlyButton: document.querySelector('#edited-only-button'),
  editorHint: document.querySelector('#editor-hint'),
  selectionKind: document.querySelector('#selection-kind'),
  selectionSummary: document.querySelector('#selection-summary'),
  activityList: document.querySelector('#activity-list'),
  sessionStatus: document.querySelector('#session-status'),
  themeSelect: document.querySelector('#theme-select'),
  toast: document.querySelector('#toast'),
  liveRegion: document.querySelector('#live-region'),
  networkBanner: document.querySelector('#network-banner'),
  treeSkeleton: document.querySelector('#tree-skeleton'),
  onboardingCard: document.querySelector('#onboarding-card'),
  dismissOnboardingButton: document.querySelector('#dismiss-onboarding-button'),
  restoreSessionButton: document.querySelector('#restore-session-button'),
};

const isComposite = (value) => value !== null && typeof value === 'object';
const clone = (value) => structuredClone(value);
const normalizeText = (value) => String(value ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

function showToast(message) {
  refs.toast.textContent = message;
  refs.liveRegion.textContent = message;
  refs.toast.classList.remove(HIDDEN_CLASS);
  clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => refs.toast.classList.add(HIDDEN_CLASS), 2200);
}

function setBusyState(isBusy, message = 'Working…') {
  state.isBusy = isBusy;
  document.body.classList.toggle('is-busy', isBusy);
  refs.treeSkeleton.classList.toggle(HIDDEN_CLASS, !isBusy);
  refs.sessionStatus.textContent = isBusy ? message : state.changedPaths.size > 0 ? 'Unsaved local edits' : 'No pending edits';
}

function addActivity(message) {
  state.activity = [message, ...state.activity.filter((item) => item !== 'No recent activity.')].slice(0, MAX_ACTIVITY_ITEMS);
}

function readLocal(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage errors
  }
}

function readStoredTheme() { return readLocal(THEME_STORAGE_KEY); }
function storeTheme(theme) { writeLocal(THEME_STORAGE_KEY, theme); }

function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function resolveTheme(theme = state.theme) {
  return theme === 'system' ? getSystemTheme() : theme;
}

function applyTheme(theme = state.theme) {
  const resolvedTheme = resolveTheme(theme);
  document.documentElement.dataset.themeSetting = theme;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.style.colorScheme = resolvedTheme;
  if (refs.themeSelect.value !== theme) refs.themeSelect.value = theme;
}

function setTheme(theme) {
  if (!VALID_THEMES.has(theme)) return;
  state.theme = theme;
  storeTheme(theme);
  applyTheme();
}

function initializeTheme() {
  const storedTheme = readStoredTheme();
  state.theme = VALID_THEMES.has(storedTheme) ? storedTheme : 'system';
  applyTheme();
}

function describeValue(value) {
  if (Array.isArray(value)) return `Array (${value.length} items)`;
  if (value === null) return 'null';
  if (typeof value === 'object') return `Object (${Object.keys(value).length} keys)`;
  if (typeof value === 'string') return value.length ? `String · ${value}` : 'Empty string';
  return `${typeof value} · ${String(value)}`;
}

function formatSelectionLabel(type, entry) {
  if (!entry) return 'Nothing selected';
  if (entry.path === ROOT_PATH) return 'Root document';
  return `${type} · ${entry.key}`;
}

function setValidationMessage(message = '') {
  refs.validationMessage.textContent = message;
  refs.validationMessage.classList.toggle(HIDDEN_CLASS, !message);
  refs.numberValue.setAttribute('aria-invalid', String(Boolean(message)));
}

function getValueAtSegments(root, segments) {
  let current = root;
  for (let index = 0; index < segments.length; index += 1) current = current?.[segments[index]];
  return current;
}

function setValueAtSegments(root, segments, nextValue) {
  const lastIndex = segments.length - 1;
  let parent = root;
  for (let index = 0; index < lastIndex; index += 1) parent = parent[segments[index]];
  parent[segments[lastIndex]] = nextValue;
}

function createTreeIndex(root) {
  const entries = [];
  const pathLookup = new Map();
  let primitiveCount = 0;
  let maxDepth = 0;
  const stack = [{ value: root, path: ROOT_PATH, key: ROOT_PATH, depth: 0, parentIndex: -1, segments: [] }];

  while (stack.length) {
    const current = stack.pop();
    const { value, path, key, depth, parentIndex, segments } = current;
    const summary = describeValue(value);
    const entry = {
      path, key, depth, parentIndex, segments,
      isComposite: isComposite(value),
      summary,
      searchText: normalizeText(`${path} ${key} ${summary}`),
      wrap: null, element: null, toggle: null, summaryLabel: null, badges: null, visible: true,
    };

    maxDepth = Math.max(maxDepth, depth);
    if (!entry.isComposite) primitiveCount += 1;
    const entryIndex = entries.push(entry) - 1;
    pathLookup.set(path, entry);

    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) stack.push({ value: value[index], path: path === ROOT_PATH ? String(index) : `${path}.${index}`, key: String(index), depth: depth + 1, parentIndex: entryIndex, segments: [...segments, String(index)] });
    } else if (entry.isComposite) {
      const objectEntries = Object.entries(value);
      for (let index = objectEntries.length - 1; index >= 0; index -= 1) {
        const [childKey, childValue] = objectEntries[index];
        stack.push({ value: childValue, path: path === ROOT_PATH ? childKey : `${path}.${childKey}`, key: childKey, depth: depth + 1, parentIndex: entryIndex, segments: [...segments, childKey] });
      }
    }
  }
  return { entries, pathLookup, primitiveCount, maxDepth };
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

  for (let index = 0; index < state.treeIndex.length; index += 1) {
    const entry = state.treeIndex[index];
    const wrap = templateRoot.cloneNode(true);
    const toggle = wrap.querySelector('.tree-toggle');
    const node = wrap.querySelector('.tree-node');
    const pathLabel = wrap.querySelector('.tree-node-path');
    const summaryLabel = wrap.querySelector('.tree-node-summary');
    const badges = wrap.querySelector('.tree-node-badges');
    wrap.dataset.index = String(index);
    wrap.style.setProperty('--tree-indent', `${entry.depth * INDENT_REM}rem`);
    pathLabel.textContent = entry.path;
    summaryLabel.textContent = entry.summary;
    node.setAttribute('aria-label', `${entry.path}, ${entry.summary}`);
    if (entry.isComposite) {
      toggle.classList.remove(HIDDEN_CLASS);
      node.classList.add(COMPOSITE_CLASS);
    }
    entry.wrap = wrap; entry.element = node; entry.toggle = toggle; entry.summaryLabel = summaryLabel; entry.badges = badges;
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
  entry.searchText = normalizeText(`${entry.path} ${entry.key} ${summary}`);
  if (entry.summaryLabel) entry.summaryLabel.textContent = summary;
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
  for (const entry of state.treeIndex) {
    if (!entry.toggle) continue;
    const collapsed = state.collapsedPaths.has(entry.path);
    entry.toggle.setAttribute('aria-expanded', String(!collapsed));
    entry.wrap.classList.toggle('collapsed', collapsed);
    entry.toggle.disabled = hasFilter;
  }
}

function renderNodeDecorators() {
  for (const entry of state.treeIndex) {
    if (!entry.element) continue;
    const changed = state.changedPaths.has(entry.path);
    entry.element.classList.toggle(MODIFIED_CLASS, changed);
    entry.badges.innerHTML = [changed ? '<span class="tree-badge tree-badge-warning">Edited</span>' : '', entry.isComposite ? '<span class="tree-badge">Group</span>' : ''].join('');
  }
}

function applyTreeFilter() {
  if (!state.treeBuilt) return;
  const entries = state.treeIndex;
  const visible = new Uint8Array(entries.length);

  if (!state.filter && !state.reviewEditedOnly) {
    visible.fill(1);
    for (let index = 0; index < entries.length; index += 1) {
      let currentIndex = entries[index].parentIndex;
      while (currentIndex !== -1) {
        if (state.collapsedPaths.has(entries[currentIndex].path)) { visible[index] = 0; break; }
        currentIndex = entries[currentIndex].parentIndex;
      }
    }
  } else {
    visible[0] = 1;
    for (let index = 0; index < entries.length; index += 1) {
      const matchesFilter = !state.filter || entries[index].searchText.includes(state.filter);
      const matchesEditedReview = !state.reviewEditedOnly || state.changedPaths.has(entries[index].path);
      if (!matchesFilter || !matchesEditedReview) continue;
      visible[index] = 1;
      if (entries[index].isComposite) revealDescendants(index, entries, visible);
      let currentIndex = entries[index].parentIndex;
      while (currentIndex !== -1 && visible[currentIndex] === 0) {
        visible[currentIndex] = 1;
        currentIndex = entries[currentIndex].parentIndex;
      }
    }
  }

  let visibleCount = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const nextVisible = visible[index] === 1;
    if (nextVisible) visibleCount += 1;
    entries[index].visible = nextVisible;
    entries[index].wrap.classList.toggle(HIDDEN_CLASS, !nextVisible);
  }
  state.visibleCount = visibleCount;
  refs.searchEmpty.classList.toggle(HIDDEN_CLASS, !((state.filter || state.reviewEditedOnly) && visibleCount <= 1));
  refs.clearSearchButton.classList.toggle(HIDDEN_CLASS, !state.filter);
  refs.editedOnlyButton.classList.toggle('is-active', state.reviewEditedOnly);
  applyCollapsedState();
}

function updateActiveNode() {
  state.selectedEntry?.element?.classList.remove(ACTIVE_CLASS);
  state.selectedEntry = state.pathLookup.get(state.selectedPath) ?? null;
  state.selectedEntry?.element?.classList.add(ACTIVE_CLASS);
}

function getSelectedValue() {
  if (!state.selectedPath || state.data === null) return null;
  const entry = state.pathLookup.get(state.selectedPath);
  return entry ? getValueAtSegments(state.data, entry.segments) : null;
}

function getOriginalSelectedValue() {
  if (!state.selectedPath || state.originalData === null) return null;
  const entry = state.pathLookup.get(state.selectedPath);
  return entry ? getValueAtSegments(state.originalData, entry.segments) : null;
}

function getEditorDraftState() {
  const entry = state.pathLookup.get(state.selectedPath);
  if (!entry || state.data === null) return { canEdit: false, changed: false, valid: false, nextValue: null, type: '' };
  const currentValue = getValueAtSegments(state.data, entry.segments);
  const originalValue = getValueAtSegments(state.originalData, entry.segments);
  const type = Array.isArray(currentValue) ? 'array' : currentValue === null ? 'null' : typeof currentValue;

  if (type === 'string') {
    const nextValue = refs.textValue.value;
    const valid = nextValue.trim().length > 0 || currentValue.length === 0 || nextValue.length >= 0;
    return { canEdit: true, changed: JSON.stringify(nextValue) !== JSON.stringify(originalValue), valid, nextValue, type };
  }
  if (type === 'number') {
    const raw = refs.numberValue.value;
    const valid = raw.trim() !== '' && Number.isFinite(Number(raw));
    const nextValue = valid ? Number(raw) : null;
    return { canEdit: true, changed: valid && JSON.stringify(nextValue) !== JSON.stringify(originalValue), valid, nextValue, type };
  }
  if (type === 'boolean') {
    const nextValue = refs.booleanValue.value === 'true';
    return { canEdit: true, changed: JSON.stringify(nextValue) !== JSON.stringify(originalValue), valid: true, nextValue, type };
  }
  return { canEdit: false, changed: false, valid: false, nextValue: null, type };
}

function persistSession() {
  if (state.data === null) {
    writeLocal(SESSION_STORAGE_KEY, '');
    return;
  }
  const payload = {
    sourceName: state.sourceName,
    originalData: state.originalData,
    data: state.data,
    selectedPath: state.selectedPath,
    changedPaths: [...state.changedPaths],
    collapsedPaths: [...state.collapsedPaths],
    filter: state.filter,
    reviewEditedOnly: state.reviewEditedOnly,
    mobilePanel: state.mobilePanel,
    activity: state.activity,
    savedAt: new Date().toISOString(),
  };
  writeLocal(SESSION_STORAGE_KEY, JSON.stringify(payload));
}

function persistUiPrefs() {
  writeLocal(UI_STORAGE_KEY, JSON.stringify({ onboardingDismissed: state.onboardingDismissed }));
}

function renderOnboarding() {
  const shouldHide = state.onboardingDismissed && state.data !== null;
  refs.onboardingCard.classList.toggle(HIDDEN_CLASS, shouldHide);
  refs.restoreSessionButton.classList.toggle(HIDDEN_CLASS, !state.canRestoreSession || state.data !== null);
}

function renderWorkspaceSummary() {
  if (state.data === null) {
    refs.fileName.textContent = 'No file selected';
    refs.summaryNodes.textContent = '0';
    refs.summaryPrimitives.textContent = '0';
    refs.summaryDepth.textContent = '0';
    refs.summaryChanges.textContent = '0';
    refs.sessionStatus.textContent = navigator.onLine ? 'Waiting for a file' : 'Offline and ready for cached work';
    return;
  }
  refs.fileName.textContent = state.sourceName || 'Untitled JSON';
  refs.summaryNodes.textContent = String(state.treeIndex.length);
  refs.summaryPrimitives.textContent = `${state.primitiveCount} primitive${state.primitiveCount === 1 ? '' : 's'}`;
  refs.summaryDepth.textContent = `${state.maxDepth} level${state.maxDepth === 1 ? '' : 's'}`;
  refs.summaryChanges.textContent = `${state.changedPaths.size} pending`;
  refs.sessionStatus.textContent = state.isBusy ? 'Updating workspace…' : state.changedPaths.size > 0 ? 'Unsaved local edits' : 'No pending edits';
}

function renderTreeStats() {
  if (state.data === null) {
    refs.treeStats.textContent = 'No file loaded';
    refs.searchStatus.textContent = 'Showing all nodes';
    refs.searchEmpty.classList.add(HIDDEN_CLASS);
    return;
  }
  refs.treeStats.textContent = `${state.treeIndex.length} nodes indexed${state.collapsedPaths.size ? ` · ${state.collapsedPaths.size} collapsed` : ''}`;
  if (!state.filter && !state.reviewEditedOnly) refs.searchStatus.textContent = state.collapsedPaths.size ? `Showing ${state.visibleCount} visible nodes` : 'Showing all nodes';
  else if (state.visibleCount <= 1) refs.searchStatus.textContent = state.reviewEditedOnly && !state.filter ? 'No edited fields to review' : `No matches for “${state.filter}”`;
  else if (state.reviewEditedOnly && state.filter) refs.searchStatus.textContent = `Reviewing ${state.visibleCount} edited matches`;
  else if (state.reviewEditedOnly) refs.searchStatus.textContent = `Reviewing ${state.visibleCount} edited nodes`;
  else refs.searchStatus.textContent = `Filtered to ${state.visibleCount} visible nodes`;
}

function renderDirtyState() {
  const dirty = state.changedPaths.size > 0;
  refs.dirtyIndicator.textContent = dirty ? `${state.changedPaths.size} unsaved change${state.changedPaths.size === 1 ? '' : 's'}` : 'Saved';
  refs.dirtyIndicator.classList.toggle('is-dirty', dirty);
  refs.downloadButton.disabled = state.data === null;
  refs.shareButton.disabled = state.data === null;
  refs.expandAllButton.disabled = state.data === null || state.filter.length > 0 || state.reviewEditedOnly;
  refs.collapseAllButton.disabled = state.data === null || state.filter.length > 0 || state.reviewEditedOnly;
  refs.editedOnlyButton.disabled = state.data === null || state.changedPaths.size === 0;
  refs.undoButton.disabled = state.undoStack.length === 0;
}

function renderSelectionMetadata(entry, value, originalValue, type) {
  if (!entry || state.data === null) {
    refs.selectionKind.textContent = 'Nothing selected';
    refs.selectionSummary.textContent = 'Open a file and pick a node to inspect its value and status.';
  } else {
    const changed = JSON.stringify(value) !== JSON.stringify(originalValue);
    refs.selectionKind.textContent = formatSelectionLabel(type, entry);
    refs.selectionSummary.textContent = changed
      ? 'This field differs from the original source and will be included in the downloaded file.'
      : entry.isComposite
        ? 'Composite nodes are read-only previews so you can inspect structure safely.'
        : 'This field matches the original source and is ready for focused editing.';
  }
  refs.activityList.innerHTML = state.activity.map((item) => `<li>${item}</li>`).join('');
}

function renderEditorControls() {
  const draft = getEditorDraftState();
  const selectedValue = getSelectedValue();
  const type = Array.isArray(selectedValue) ? 'array' : selectedValue === null ? 'null' : typeof selectedValue;
  if (!draft.canEdit) {
    refs.saveButton.disabled = true;
    setValidationMessage('');
    refs.resetButton.disabled = type === 'array' || type === 'object' || type === 'null' || state.selectedPath === ROOT_PATH;
    return;
  }
  refs.saveButton.disabled = !draft.valid || !draft.changed;
  refs.resetButton.disabled = !draft.changed || state.selectedPath === ROOT_PATH;
  if (draft.type === 'number' && !draft.valid) setValidationMessage('Enter a valid number before saving.');
  else if (draft.type === 'string' && refs.textValue.value.length > 2400) setValidationMessage('This value is large; double-check before saving on mobile.');
  else setValidationMessage('');
}

function renderEditor() {
  if (state.data === null || !state.selectedPath) {
    refs.editorEmpty.classList.remove(HIDDEN_CLASS);
    refs.editorForm.classList.add(HIDDEN_CLASS);
    refs.selectionPath.textContent = 'No field selected';
    refs.copyPathButton.disabled = true;
    refs.editorHint.textContent = 'Use the tree to select a node, then edit strings, numbers, or booleans with confidence.';
    setValidationMessage('');
    renderSelectionMetadata(null, null, null, '');
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
  refs.copyPathButton.disabled = false;
  refs.textValueGroup.classList.toggle(HIDDEN_CLASS, type !== 'string');
  refs.numberValueGroup.classList.toggle(HIDDEN_CLASS, type !== 'number');
  refs.booleanValueGroup.classList.toggle(HIDDEN_CLASS, type !== 'boolean');
  refs.nullValueGroup.classList.toggle(HIDDEN_CLASS, type !== 'null');
  refs.compositeValueGroup.classList.toggle(HIDDEN_CLASS, !['array', 'object'].includes(type));

  if (type === 'string') refs.textValue.value = value;
  else if (type === 'number') refs.numberValue.value = String(value);
  else if (type === 'boolean') refs.booleanValue.value = String(value);
  else if (type === 'array' || type === 'object') refs.compositeValue.value = JSON.stringify(value, null, 2);

  refs.editorHint.textContent = entry.isComposite ? 'Composite nodes are read-only previews. Select a primitive field to make an editable change.' : 'Save applies only to the selected field, which makes focused edits easier to review.';
  renderSelectionMetadata(entry, value, originalValue, type);
  renderEditorControls();
}

function renderTree() {
  if (!state.treeBuilt) buildTreeDom();
  applyTreeFilter();
  updateActiveNode();
  renderNodeDecorators();
}

function render() {
  renderTree();
  renderWorkspaceSummary();
  renderTreeStats();
  renderDirtyState();
  renderEditor();
  renderOnboarding();
  persistSession();
  persistUiPrefs();
}

async function loadJsonData(data, sourceName = 'session.json') {
  state.sourceName = sourceName;
  state.originalData = clone(data);
  state.data = clone(data);
  state.selectedPath = ROOT_PATH;
  state.selectedEntry = null;
  state.collapsedPaths.clear();
  state.changedPaths.clear();
  state.undoStack = [];
  state.activity = [];
  state.reviewEditedOnly = false;
  addActivity(`Loaded ${sourceName}.`);
  state.pendingFilter = refs.searchInput.value.trim().toLowerCase();
  state.filter = normalizeText(state.pendingFilter);
  const { entries, pathLookup, primitiveCount, maxDepth } = createTreeIndex(state.data);
  state.treeIndex = entries;
  state.pathLookup = pathLookup;
  state.primitiveCount = primitiveCount;
  state.maxDepth = maxDepth;
  state.treeBuilt = false;
  if (!window.matchMedia('(min-width: 980px)').matches) setMobilePanel('structure');
  render();
}

async function loadJsonFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') {
    showToast('Please choose a valid JSON file.');
    return;
  }
  setBusyState(true, 'Loading JSON…');
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    await loadJsonData(parsed, file.name);
    showToast(`Loaded ${file.name}`);
  } catch (error) {
    showToast(`Could not parse JSON: ${error.message}`);
  } finally {
    setBusyState(false);
  }
}

function scheduleTreeRender() {
  if (state.searchFrame) cancelAnimationFrame(state.searchFrame);
  state.searchFrame = requestAnimationFrame(() => {
    state.searchFrame = 0;
    renderTree();
    renderTreeStats();
    renderDirtyState();
    persistSession();
  });
}

function setMobilePanel(panel) {
  state.mobilePanel = panel;
  document.body.classList.toggle('mobile-structure-active', panel === 'structure');
  document.body.classList.toggle('mobile-editor-active', panel === 'editor');
  refs.showStructureButton.classList.toggle('is-selected', panel === 'structure');
  refs.showEditorButton.classList.toggle('is-selected', panel === 'editor');
  refs.showStructureButton.setAttribute('aria-selected', String(panel === 'structure'));
  refs.showEditorButton.setAttribute('aria-selected', String(panel === 'editor'));
}

function saveCurrentSelectionForUndo(entry) {
  state.undoStack.push({ path: entry.path, previousValue: clone(getValueAtSegments(state.data, entry.segments)) });
  if (state.undoStack.length > 12) state.undoStack.shift();
}

function restoreSession() {
  const raw = readLocal(SESSION_STORAGE_KEY);
  if (!raw) return false;
  try {
    const session = JSON.parse(raw);
    if (!session?.data || !session?.originalData) return false;
    state.sourceName = session.sourceName || 'Recovered session';
    state.originalData = session.originalData;
    state.data = session.data;
    state.selectedPath = session.selectedPath || ROOT_PATH;
    state.changedPaths = new Set(session.changedPaths || []);
    state.collapsedPaths = new Set(session.collapsedPaths || []);
    state.filter = normalizeText(session.filter || '');
    state.pendingFilter = session.filter || '';
    refs.searchInput.value = session.filter || '';
    state.reviewEditedOnly = Boolean(session.reviewEditedOnly);
    state.mobilePanel = session.mobilePanel || 'structure';
    state.activity = Array.isArray(session.activity) && session.activity.length ? session.activity : ['Session restored.'];
    const { entries, pathLookup, primitiveCount, maxDepth } = createTreeIndex(state.data);
    state.treeIndex = entries; state.pathLookup = pathLookup; state.primitiveCount = primitiveCount; state.maxDepth = maxDepth; state.treeBuilt = false;
    render();
    showToast('Restored your last local session');
    return true;
  } catch {
    return false;
  }
}

function loadUiPrefs() {
  try {
    const prefs = JSON.parse(readLocal(UI_STORAGE_KEY) || '{}');
    state.onboardingDismissed = Boolean(prefs.onboardingDismissed);
  } catch {
    state.onboardingDismissed = false;
  }
  state.canRestoreSession = Boolean(readLocal(SESSION_STORAGE_KEY));
}

async function shareCurrentState() {
  if (!state.data) return;
  const url = `${window.location.href.split('#')[0]}#${encodeURIComponent(state.selectedPath || ROOT_PATH)}`;
  const payload = { title: 'JSON Navigator', text: `Review ${state.sourceName || 'JSON document'} at ${state.selectedPath || ROOT_PATH}`, url };
  try {
    if (navigator.share) await navigator.share(payload);
    else await navigator.clipboard.writeText(url);
    showToast(navigator.share ? 'Share sheet opened' : 'Deep link copied to clipboard');
  } catch {
    showToast('Share cancelled');
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').catch(() => addActivity('Offline cache could not be enabled.'));
}

function updateNetworkUi() {
  refs.networkBanner.classList.toggle(HIDDEN_CLASS, navigator.onLine);
}

refs.treeView.addEventListener('click', (event) => {
  const toggle = event.target.closest('.tree-toggle');
  if (toggle) {
    const entry = state.treeIndex[Number(toggle.closest('.tree-node-wrap')?.dataset.index)];
    if (!entry || !entry.isComposite || state.filter) return;
    if (state.collapsedPaths.has(entry.path)) state.collapsedPaths.delete(entry.path);
    else state.collapsedPaths.add(entry.path);
    renderTree(); renderTreeStats(); persistSession();
    return;
  }
  const node = event.target.closest('.tree-node');
  if (!node) return;
  const entry = state.treeIndex[Number(node.closest('.tree-node-wrap')?.dataset.index)];
  if (!entry || state.selectedPath === entry.path) return;
  state.selectedPath = entry.path;
  window.location.hash = encodeURIComponent(entry.path);
  if (!window.matchMedia('(min-width: 980px)').matches) setMobilePanel('editor');
  render();
});

refs.fileInput.addEventListener('change', async (event) => { await loadJsonFile(event.target.files[0]); refs.fileInput.value = ''; });
refs.demoButton.addEventListener('click', async () => { setBusyState(true, 'Loading demo data…'); await new Promise((resolve) => window.setTimeout(resolve, 180)); await loadJsonData(DEMO_DATA, 'demo-data.json'); setBusyState(false); showToast('Demo data loaded'); });
refs.searchInput.addEventListener('input', (event) => {
  if (!window.matchMedia('(min-width: 980px)').matches) setMobilePanel('structure');
  state.pendingFilter = event.target.value.trim();
  if (state.searchDebounceTimer) clearTimeout(state.searchDebounceTimer);
  state.searchDebounceTimer = window.setTimeout(() => { state.searchDebounceTimer = 0; state.filter = normalizeText(state.pendingFilter); scheduleTreeRender(); }, 100);
});
refs.clearSearchButton.addEventListener('click', () => { refs.searchInput.value = ''; state.pendingFilter = ''; state.filter = ''; scheduleTreeRender(); refs.searchInput.focus(); });
refs.showStructureButton.addEventListener('click', () => setMobilePanel('structure'));
refs.showEditorButton.addEventListener('click', () => setMobilePanel('editor'));
refs.themeSelect.addEventListener('change', (event) => setTheme(event.target.value));
refs.editedOnlyButton.addEventListener('click', () => {
  if (state.data === null || state.changedPaths.size === 0) return;
  state.reviewEditedOnly = !state.reviewEditedOnly;
  if (state.reviewEditedOnly && !state.changedPaths.has(state.selectedPath)) {
    const [firstChangedPath] = state.changedPaths;
    if (firstChangedPath) state.selectedPath = firstChangedPath;
  }
  scheduleTreeRender(); renderEditor();
});
refs.copyPathButton.addEventListener('click', async () => {
  if (!state.selectedPath) return;
  try { await navigator.clipboard.writeText(state.selectedPath); addActivity(`Copied path ${state.selectedPath}.`); renderSelectionMetadata(state.selectedEntry, getSelectedValue(), getOriginalSelectedValue(), refs.valueType.value); showToast('Path copied'); } catch { showToast('Clipboard access is unavailable in this browser.'); }
});
refs.expandAllButton.addEventListener('click', () => { state.collapsedPaths.clear(); renderTree(); renderTreeStats(); persistSession(); });
refs.collapseAllButton.addEventListener('click', () => { state.collapsedPaths = new Set(state.treeIndex.filter((entry) => entry.isComposite && entry.path !== ROOT_PATH).map((entry) => entry.path)); renderTree(); renderTreeStats(); persistSession(); });
refs.editorForm.addEventListener('input', () => renderEditorControls());
refs.editorForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const entry = state.pathLookup.get(state.selectedPath);
  if (!entry || entry.path === ROOT_PATH) return;
  const draft = getEditorDraftState();
  if (!draft.canEdit || !draft.valid || !draft.changed) return;
  saveCurrentSelectionForUndo(entry);
  setValueAtSegments(state.data, entry.segments, draft.nextValue);
  const originalValue = getValueAtSegments(state.originalData, entry.segments);
  if (JSON.stringify(draft.nextValue) === JSON.stringify(originalValue)) state.changedPaths.delete(entry.path); else state.changedPaths.add(entry.path);
  refreshAncestorMetadata(entry);
  addActivity(`Saved ${entry.path}.`);
  render();
  showToast('Changes saved locally');
});
refs.undoButton.addEventListener('click', () => {
  const lastChange = state.undoStack.pop();
  if (!lastChange) return;
  const entry = state.pathLookup.get(lastChange.path);
  if (!entry) return;
  setValueAtSegments(state.data, entry.segments, clone(lastChange.previousValue));
  const originalValue = getValueAtSegments(state.originalData, entry.segments);
  const currentValue = getValueAtSegments(state.data, entry.segments);
  if (JSON.stringify(currentValue) === JSON.stringify(originalValue)) state.changedPaths.delete(entry.path); else state.changedPaths.add(entry.path);
  state.selectedPath = entry.path;
  refreshAncestorMetadata(entry);
  addActivity(`Undid ${entry.path}.`);
  render();
  showToast('Last save undone');
});
refs.resetButton.addEventListener('click', () => {
  const entry = state.pathLookup.get(state.selectedPath);
  if (!entry || entry.path === ROOT_PATH) return;
  const originalValue = clone(getValueAtSegments(state.originalData, entry.segments));
  setValueAtSegments(state.data, entry.segments, originalValue);
  state.changedPaths.delete(entry.path);
  refreshAncestorMetadata(entry);
  addActivity(`Reset ${entry.path}.`);
  render();
  showToast('Field reset');
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
  addActivity(`Downloaded ${anchor.download}.`);
  renderSelectionMetadata(state.selectedEntry, getSelectedValue(), getOriginalSelectedValue(), refs.valueType.value);
  showToast('Download started');
});
refs.shareButton.addEventListener('click', shareCurrentState);
refs.dismissOnboardingButton.addEventListener('click', () => { state.onboardingDismissed = true; renderOnboarding(); persistUiPrefs(); });
refs.restoreSessionButton.addEventListener('click', () => { if (restoreSession()) state.canRestoreSession = false; });
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', async (event) => { event.preventDefault(); const [file] = [...(event.dataTransfer?.files || [])]; await loadJsonFile(file); });
window.addEventListener('keydown', (event) => {
  const modifier = event.metaKey || event.ctrlKey;
  if (modifier && event.key.toLowerCase() === 'f') { event.preventDefault(); refs.searchInput.focus(); refs.searchInput.select(); }
  if (modifier && event.key.toLowerCase() === 's') { if (refs.saveButton.disabled) return; event.preventDefault(); refs.editorForm.requestSubmit(); }
  if (event.key === 'Escape' && document.activeElement === refs.searchInput) { refs.searchInput.value = ''; state.pendingFilter = ''; state.filter = ''; scheduleTreeRender(); refs.searchInput.blur(); }
});
const systemThemeMedia = window.matchMedia('(prefers-color-scheme: light)');
if (typeof systemThemeMedia.addEventListener === 'function') systemThemeMedia.addEventListener('change', () => { if (state.theme === 'system') applyTheme(); });
else if (typeof systemThemeMedia.addListener === 'function') systemThemeMedia.addListener(() => { if (state.theme === 'system') applyTheme(); });
window.addEventListener('beforeunload', (event) => { if (state.changedPaths.size === 0) return; event.preventDefault(); event.returnValue = ''; });
window.addEventListener('resize', () => setMobilePanel(state.mobilePanel));
window.addEventListener('online', () => { updateNetworkUi(); showToast('Back online'); });
window.addEventListener('offline', () => { updateNetworkUi(); showToast('You are offline. Cached content remains available.'); });
window.addEventListener('error', (event) => { addActivity(`Error: ${event.message}`); renderSelectionMetadata(state.selectedEntry, getSelectedValue(), getOriginalSelectedValue(), refs.valueType.value); });

initializeTheme();
loadUiPrefs();
updateNetworkUi();
setMobilePanel(state.mobilePanel);
registerServiceWorker();
if (window.location.hash) state.selectedPath = decodeURIComponent(window.location.hash.slice(1));
if (!restoreSession()) render();
