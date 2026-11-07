import { connectRoot, getRootStatus, setRoot } from './shared/services/data-root-manager.js';
import { browserRoot } from './shared/services/browser-data-root.js';
import { copyStorageInto, summarizeStorage } from './shared/services/browser-storage-copy.js';
import * as modelProviders from './shared/services/model-providers.js';
import { createProvider as createLmStudioProvider } from './shared/services/providers-lmstudio.js';
import {
  createProvider as createUnslothStudioProvider,
  saveApiKey as saveUnslothStudioApiKey,
} from './shared/services/providers-unsloth-studio.js';

const statusBox = document.querySelector('#folder-status');
const statusTitle = document.querySelector('#status-title');
const statusDetail = document.querySelector('#status-detail');
const chooseButton = document.querySelector('#choose-folder');
const browserHelp = document.querySelector('#browser-help');
const storageBox = document.querySelector('#browser-storage');
const storageTitle = document.querySelector('#browser-storage-title');
const storageDetail = document.querySelector('#browser-storage-detail');
const copyButton = document.querySelector('#copy-into-folder');
const copyStatus = document.querySelector('#copy-status');
let folderReady = false;
let folderName = '';
let storedFiles = 0;
const endpointForm = document.querySelector('#model-endpoint-form');
const providerType = document.querySelector('#model-provider-type');
const providerName = document.querySelector('#model-provider-name');
const providerUrl = document.querySelector('#model-provider-url');
const providerKey = document.querySelector('#model-provider-key');
const providerKeyField = document.querySelector('#endpoint-key-field');
const providerList = document.querySelector('#model-provider-list');
const modelStatus = document.querySelector('#model-connect-status');
const addProviderButton = document.querySelector('#add-model-provider');

const LOCAL_PROVIDER_TYPES = new Set(['lmstudio', 'unsloth-studio', 'lemonade']);

function showStatus(kind, title, detail, buttonLabel) {
  statusBox.dataset.status = kind;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
  if (buttonLabel) chooseButton.textContent = buttonLabel;
}

async function refreshStatus() {
  if (typeof window.showDirectoryPicker !== 'function') {
    folderReady = false;
    showStatus(
      'browser',
      'Your work is saved in this browser',
      'The apps keep what you make in this browser’s private storage, so nothing needs setting up. Saving to a folder on your disk needs a current version of Chrome or Edge.',
      'Folder access unavailable',
    );
    browserHelp.textContent = 'Browser storage belongs to this website on this browser. Clearing the site’s data in your browser settings removes it.';
    chooseButton.disabled = true;
    return;
  }

  chooseButton.disabled = false;
  const status = await getRootStatus();
  folderReady = status.status === 'ready';
  folderName = status.name || '';
  if (status.status === 'ready') {
    showStatus('ready', `Saving to “${status.name}”`, 'Each app keeps its work in its own subfolder here. Anything saved in the browser before you chose this folder can be copied in below.', 'Change folder');
  } else if (status.status === 'needs-permission') {
    showStatus('attention', `“${status.name}” needs permission`, 'Choose it again, or select a different working folder.', 'Reconnect folder');
  } else {
    showStatus('browser', 'Your work is saved in this browser', 'Until you choose a folder, the apps keep what you make in this browser’s private storage. Choose a folder to save files on your disk instead.', 'Choose folder');
  }
  // The storage count may have finished first; the button depends on both.
  if (storedFiles) updateCopyButton();
}

// ── Browser storage → folder ──────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function refreshBrowserStorage() {
  const root = await browserRoot();
  if (!root) { storageBox.hidden = true; return; }
  const summary = await summarizeStorage(root).catch(() => ({ files: 0, bytes: 0, apps: [] }));
  storedFiles = summary.files;
  if (!summary.files) { storageBox.hidden = true; return; }
  storageBox.hidden = false;
  storageTitle.textContent = `${summary.files} file${summary.files === 1 ? '' : 's'} saved in this browser`;
  storageDetail.textContent = `${formatBytes(summary.bytes)} from ${summary.apps.join(', ') || 'the apps'}.`;
  updateCopyButton();
}

function updateCopyButton() {
  const canCopy = folderReady && storedFiles > 0;
  copyButton.disabled = !canCopy;
  copyButton.textContent = folderReady ? `Copy into “${folderName}”` : 'Copy into folder';
  storageBox.dataset.offer = canCopy ? 'true' : 'false';
  if (!folderReady && !copyStatus.textContent) {
    copyStatus.textContent = typeof window.showDirectoryPicker === 'function'
      ? 'Choose a folder above, then copy your browser work into it.'
      : 'Copying into a folder needs Chrome or Edge.';
  }
}

copyButton.addEventListener('click', async () => {
  copyButton.disabled = true;
  copyStatus.textContent = 'Getting access to the folder…';
  try {
    const [source, folder] = await Promise.all([browserRoot(), connectRoot()]);
    if (!source) throw new Error('Browser storage is not available.');
    if (!folder) throw new Error('The folder is not connected. Choose it again above.');
    const report = await copyStorageInto(source, folder, {
      onProgress: ({ done }) => { copyStatus.textContent = `Copying… ${done} of ${storedFiles}`; },
    });
    const parts = [`Copied ${report.copied} file${report.copied === 1 ? '' : 's'} into “${folder.name}”.`];
    if (report.identical) parts.push(`${report.identical} ${report.identical === 1 ? 'was' : 'were'} already there.`);
    if (report.keptBoth.length) {
      parts.push(`${report.keptBoth.length} differed from the folder's version and ${report.keptBoth.length === 1 ? 'was' : 'were'} saved beside it with “(from browser)” in the name.`);
    }
    if (report.settingsKept) parts.push(`The folder's own settings were kept.`);
    if (report.failed.length) parts.push(`${report.failed.length} could not be copied: ${report.failed.slice(0, 3).map(f => f.path).join(', ')}${report.failed.length > 3 ? '…' : ''}.`);
    parts.push('Your browser copy is kept.');
    copyStatus.textContent = parts.join(' ');
  } catch (error) {
    copyStatus.textContent = `The copy stopped: ${error?.message || error}`;
  } finally {
    await refreshStatus().catch(() => {});
    updateCopyButton();
  }
});

chooseButton.addEventListener('click', async () => {
  chooseButton.disabled = true;
  showStatus('working', 'Waiting for your folder choice…', 'Use the system picker to choose or create a folder.', chooseButton.textContent);
  try {
    await setRoot();
    await refreshStatus();
    copyStatus.textContent = '';
    await refreshBrowserStorage();
    if (storedFiles) copyStatus.textContent = `New work now saves to this folder. Your ${storedFiles} earlier file${storedFiles === 1 ? ' is' : 's are'} still in the browser: copy ${storedFiles === 1 ? 'it' : 'them'} in with the button below.`;
  } catch (error) {
    if (error?.name === 'AbortError') {
      await refreshStatus();
      return;
    }
    showStatus('error', 'The folder could not be connected', error?.message || 'Please try again.', 'Try again');
    chooseButton.disabled = false;
  }
});

refreshStatus().catch((error) => {
  showStatus('error', 'Folder status could not be read', error?.message || 'Please reload and try again.', 'Try again');
  chooseButton.disabled = false;
});
refreshBrowserStorage().catch(() => { storageBox.hidden = true; });

function setModelStatus(kind, message) {
  modelStatus.dataset.status = kind || '';
  modelStatus.textContent = message || '';
}

function localProviderEntries() {
  return modelProviders.getProviders().filter(provider => LOCAL_PROVIDER_TYPES.has(provider.type));
}

async function testLocalProvider(provider, statusNode) {
  statusNode.dataset.status = 'working';
  statusNode.textContent = 'Testing connection…';
  const result = await modelProviders.testConnection(provider);
  if (!result.ok) {
    statusNode.dataset.status = 'error';
    statusNode.textContent = result.error || 'Connection failed';
    return false;
  }

  let modelCount = result.modelCount || 0;
  try {
    const models = await modelProviders.refreshProviderModels(provider.id);
    modelCount = models.length || modelCount;
  } catch {
    // The connection test succeeded; model refresh errors are shown when the
    // user opens a gallery model picker, so do not turn success into failure.
  }
  statusNode.dataset.status = 'ready';
  statusNode.textContent = `Connected${modelCount ? ` — ${modelCount} model${modelCount === 1 ? '' : 's'} found` : ''}`;
  return true;
}

function renderProviderList() {
  providerList.replaceChildren();
  const entries = localProviderEntries();
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'model-provider-empty';
    empty.textContent = 'No local model server connected yet.';
    providerList.append(empty);
    return;
  }

  for (const provider of entries) {
    const card = document.createElement('article');
    card.className = 'model-provider-row';

    const details = document.createElement('div');
    details.className = 'model-provider-details';
    const title = document.createElement('strong');
    title.textContent = provider.name || provider.type;
    const url = document.createElement('code');
    url.textContent = provider.baseUrl;
    const state = document.createElement('span');
    state.className = 'model-provider-state';
    state.textContent = provider.enabled === false ? 'Disabled' : 'Ready to test';
    details.append(title, url, state);

    const actions = document.createElement('div');
    actions.className = 'model-provider-actions';

    const enabledLabel = document.createElement('label');
    enabledLabel.className = 'model-enabled-toggle';
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = provider.enabled !== false;
    enabled.addEventListener('change', () => {
      modelProviders.updateProvider(provider.id, { enabled: enabled.checked });
      state.dataset.status = enabled.checked ? '' : 'muted';
      state.textContent = enabled.checked ? 'Ready to test' : 'Disabled';
    });
    enabledLabel.append(enabled, document.createTextNode(' Enabled'));

    const testButton = document.createElement('button');
    testButton.className = 'button compact';
    testButton.type = 'button';
    testButton.textContent = 'Test';
    testButton.addEventListener('click', async () => {
      testButton.disabled = true;
      await testLocalProvider(provider, state);
      testButton.disabled = false;
    });

    const removeButton = document.createElement('button');
    removeButton.className = 'button compact danger';
    removeButton.type = 'button';
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => {
      if (!window.confirm(`Remove ${provider.name || 'this local endpoint'}?`)) return;
      modelProviders.removeProvider(provider.id);
      renderProviderList();
      setModelStatus('', 'Endpoint removed.');
    });

    actions.append(enabledLabel, testButton, removeButton);
    card.append(details, actions);
    providerList.append(card);
  }
}

function applyProviderTypeDefaults() {
  const unsloth = providerType.value === 'unsloth-studio';
  providerName.value = unsloth ? 'Unsloth Studio' : 'LM Studio';
  providerUrl.value = unsloth ? 'http://127.0.0.1:8888' : 'http://localhost:1234';
  providerKeyField.hidden = !unsloth;
}

providerType.addEventListener('change', applyProviderTypeDefaults);

endpointForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  addProviderButton.disabled = true;
  setModelStatus('working', 'Saving endpoint and requesting local-network access…');
  try {
    const type = providerType.value;
    const args = {
      name: providerName.value.trim(),
      baseUrl: providerUrl.value.trim(),
      tags: ['local', 'public-test-bench'],
    };
    const provider = type === 'unsloth-studio'
      ? createUnslothStudioProvider(args)
      : createLmStudioProvider(args);
    modelProviders.addProvider(provider);
    if (type === 'unsloth-studio') saveUnslothStudioApiKey(provider, providerKey.value);
    renderProviderList();

    const row = [...providerList.querySelectorAll('.model-provider-row')].at(-1);
    const state = row?.querySelector('.model-provider-state') || modelStatus;
    const connected = await testLocalProvider(provider, state);
    setModelStatus(
      connected ? 'ready' : 'attention',
      connected
        ? 'Local models are ready. Open any gallery and select one from its model picker.'
        : 'The endpoint was saved. Follow the message above, then press Test again.',
    );
  } catch (error) {
    setModelStatus('error', error?.message || 'The endpoint could not be added.');
  } finally {
    addProviderButton.disabled = false;
  }
});

renderProviderList();
// Provider settings can hydrate from the connected data root just after module
// startup. Re-render once so disk-backed endpoints appear without a refresh.
setTimeout(renderProviderList, 250);
