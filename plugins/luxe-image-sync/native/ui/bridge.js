const state = {
  files: [], currentPath: null, source: 'hiviewer', luxeConnected: false,
  latestSequence: 0, pendingSequence: null, result: null,
  hostSequence: 0,
};
let labels = {};
let ready = false;
let updateBusy = false;
let updateVersion = null;
const bufferedEvents = [];
const invoke = (command, args) => window.__TAURI__.core.invoke(command, args);
const t = (key, args = {}) => (labels[`image_sync.${key}`] || key)
  .replace(/\{\{(\w+)\}\}/g, (_, name) => String(args[name] ?? ''));
const normalizePath = (path) => path.replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase();
const currentIndex = () => state.currentPath
  ? state.files.findIndex((path) => normalizePath(path) === normalizePath(state.currentPath)) : -1;
const setStatus = (text) => { document.querySelector('#status').textContent = text; };

function render() {
  document.querySelector('h1').textContent = t('title');
  document.title = t('title');
  const updateButton = document.querySelector('#update');
  updateButton.textContent = t(updateBusy ? 'update_busy' : updateVersion ? 'update_download' : 'update_check', { version: updateVersion });
  updateButton.disabled = !ready || updateBusy;
  document.querySelector('#path').textContent = state.currentPath || t('no_image');
  for (const [id, key] of [['previous', 'previous'], ['next', 'next']]) {
    const button = document.querySelector(`#${id}`);
    button.textContent = t(key);
    button.disabled = !ready || !state.luxeConnected || currentIndex() < 0;
  }
  const badge = document.querySelector('#connection');
  badge.textContent = t(state.luxeConnected ? 'connected' : 'disconnected');
  badge.className = `badge ${state.luxeConnected ? 'ok' : 'warn'}`;
  if (state.pendingSequence !== null) setStatus(t('pending'));
  else if (state.result) {
    const reasonKey = `reason.${state.result.reason}`;
    setStatus(state.result.accepted ? t('applied') : t('rejected', {
      reason: labels[`image_sync.${reasonKey}`] ? t(reasonKey) : t('reason.other'),
    }));
  } else setStatus(t(state.source === 'luxe' ? 'from_luxe' : 'waiting'));
}

document.querySelector('#update').onclick = async () => {
  if (!ready || updateBusy) return;
  const download = updateVersion !== null;
  updateBusy = true;
  const status = document.querySelector('#update-status');
  status.textContent = t('update_busy');
  render();
  try {
    const result = await invoke('update_plugin', { download });
    updateVersion = result.available ? result.version : null;
    if (result.path) {
      status.textContent = t('update_install', { version: result.version, path: result.path });
      updateVersion = null;
    } else status.textContent = t(result.available ? 'update_available' : 'update_latest', { version: result.version });
  } catch (error) {
    console.warn('plugin update failed', error);
    status.textContent = t('update_failed', { error: String(error) });
  } finally {
    updateBusy = false;
    render();
  }
};

function move(delta) {
  const index = currentIndex();
  if (!ready || !state.luxeConnected || index < 0) return;
  const next = state.files[(index + delta + state.files.length) % state.files.length];
  // Optimistic path display enables rapid navigation; only an ACK shows success.
  state.currentPath = next;
  state.source = 'plugin';
  state.result = null;
  void invoke('select_image', { imagePath: next }).catch((error) => {
    console.warn('image sync send failed', error);
    setStatus(t('send_failed'));
  });
  render();
}

document.querySelector('#previous').onclick = () => move(-1);
document.querySelector('#next').onclick = () => move(1);
window.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.isComposing
    || event.target?.closest?.('input, textarea, select, button, [contenteditable="true"]')) return;
  const key = event.key.toLowerCase();
  if ((key === 'a' || key === 'd') && ready && state.luxeConnected && currentIndex() >= 0) {
    event.preventDefault();
    move(key === 'a' ? -1 : 1);
  }
});

function applyEvent(name, payload) {
  if (name === 'viewer-updated') {
    if (Number.isSafeInteger(payload.sequence) && payload.sequence < state.hostSequence) return;
    state.hostSequence = Math.max(state.hostSequence, payload.sequence || 0);
    const testMode = payload.testMachineColumnPath != null;
    state.files = testMode ? (payload.testMachineFiles || []) : (payload.files || []);
    state.currentPath = testMode ? (payload.testMachineCurrentPath || null) : (payload.currentPath || null);
    state.source = 'hiviewer';
    state.result = null;
    if (!state.currentPath) state.pendingSequence = null;
  } else if (name === 'luxe-selection') {
    state.currentPath = payload.imagePath || payload.imagePaths?.[0] || null;
    state.source = 'luxe';
    state.result = null;
  } else if (name === 'luxe-connection') state.luxeConnected = payload === true;
  else if (name === 'luxe-sync-pending' && payload >= state.latestSequence) {
    state.latestSequence = payload;
    state.pendingSequence = payload;
    state.result = null;
  } else if (name === 'luxe-sync-result' && payload.sequence >= state.latestSequence) {
    state.latestSequence = payload.sequence;
    state.pendingSequence = null;
    state.result = payload;
  } else if (name === 'luxe-sync-cleared') {
    state.pendingSequence = null;
    state.result = null;
  }
  render();
}

// Install all listeners before requesting recovery state, then replay events that
// arrived while IPC was in flight. Avoid losing the initial host snapshot.
const registrations = [];
void (async () => {
  try {
    for (const name of ['viewer-updated', 'luxe-selection', 'luxe-connection', 'luxe-sync-pending', 'luxe-sync-result', 'luxe-sync-cleared']) {
      registrations.push(await window.__TAURI__.event.listen(name, ({ payload }) => {
        if (ready) applyEvent(name, payload);
        else {
          if (bufferedEvents.length >= 64) bufferedEvents.shift();
          bufferedEvents.push([name, payload]);
        }
      }));
    }
    const bundles = await invoke('get_all_locale_bundles');
    const locale = (navigator.language || '').replace('-', '_');
    const code = Object.keys(bundles).find((code) => code.toLowerCase() === locale.toLowerCase())
      || Object.keys(bundles).find((code) => code.split('_')[0] === locale.split('_')[0]) || 'zh_CN';
    labels = bundles[code] || bundles.zh_CN || {};
    document.querySelector('#update-status').textContent = t('update_hint');
    document.documentElement.lang = code.replace('_', '-');
    await window.__TAURI__.window.getCurrentWindow().setTitle(t('title'));
    const initial = await invoke('get_bridge_state');
    applyEvent('viewer-updated', initial.snapshot);
    if (initial.lastSelection) applyEvent('luxe-selection', initial.lastSelection);
    applyEvent('luxe-connection', initial.connected);
    if (initial.lastAck) applyEvent('luxe-sync-result', initial.lastAck);
    if (initial.pendingSequence != null) applyEvent('luxe-sync-pending', initial.pendingSequence);
    ready = true;
    for (const event of bufferedEvents.splice(0)) applyEvent(...event);
    render();
  } catch (error) {
    for (const unlisten of registrations.splice(0)) unlisten();
    console.warn('image sync initialization failed', error);
    setStatus(t('startup_failed'));
  }
})();
window.addEventListener('unload', () => {
  for (const unlisten of registrations.splice(0)) unlisten();
});
