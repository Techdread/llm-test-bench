import { getRootStatus, setRoot } from './shared/services/data-root-manager.js';

const statusBox = document.querySelector('#folder-status');
const statusTitle = document.querySelector('#status-title');
const statusDetail = document.querySelector('#status-detail');
const chooseButton = document.querySelector('#choose-folder');
const browserHelp = document.querySelector('#browser-help');

function showStatus(kind, title, detail, buttonLabel) {
  statusBox.dataset.status = kind;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
  if (buttonLabel) chooseButton.textContent = buttonLabel;
}

async function refreshStatus() {
  if (typeof window.showDirectoryPicker !== 'function') {
    showStatus(
      'unsupported',
      'Folder access is not supported in this browser',
      'Open this website in a current version of Chrome or Edge to save projects directly to a folder.',
      'Folder access unavailable',
    );
    browserHelp.textContent = 'You can still explore the bundled samples, but durable folder-backed saving requires the File System Access API.';
    chooseButton.disabled = true;
    return;
  }

  chooseButton.disabled = false;
  const status = await getRootStatus();
  if (status.status === 'ready') {
    showStatus('ready', `Connected to “${status.name}”`, 'The three galleries can now create their own app folders here.', 'Change folder');
  } else if (status.status === 'needs-permission') {
    showStatus('attention', `“${status.name}” needs permission`, 'Choose it again, or select a different working folder.', 'Reconnect folder');
  } else {
    showStatus('empty', 'No folder connected yet', 'Choose a folder you own and are happy for the galleries to organise.', 'Choose folder');
  }
}

chooseButton.addEventListener('click', async () => {
  chooseButton.disabled = true;
  showStatus('working', 'Waiting for your folder choice…', 'Use the system picker to choose or create a folder.', chooseButton.textContent);
  try {
    await setRoot();
    await refreshStatus();
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
