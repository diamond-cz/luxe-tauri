import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

function loadModule(relativePath, mocks = {}) {
  const url = new URL(relativePath, import.meta.url);
  const { outputText } = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const localRequire = createRequire(url);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(
    (id) => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id), module, module.exports,
  );
  return module.exports;
}
const matching = loadModule('../src/services/imageSyncMatching.ts');
const receiverModule = loadModule('../src/services/imageSyncReceiver.ts');
const entry = (name, root = 'C:/images') => ({ name, jpg_path: `${root}/${name}.jpg`, toml_path: `${root}/${name}.toml` });
const delivery = (sequence, imagePath = 'C:/images/a.jpg', sourceInstance = 'viewer-test') => ({
  protocolVersion: 1, kind: 'selection', sourceInstance, sequence, imagePath, deliveryId: String(sequence),
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('matching completes exact candidates before fallback and rejects all ambiguities', () => {
  const imageDirs = { 'ISP6S|0': { entries: [entry('a'), entry('b')] } };
  const find = (paths, dirs = imageDirs) => matching.findIndexedImage(dirs, paths);
  assert.equal(find(['D:/other/a.jpg', 'c:\\IMAGES\\B.jpg']).match.index, 1);
  assert.equal(find(['D:/other/a.jpg']).match.path, 'C:/images/a.jpg');
  assert.equal(find(['D:/other/missing.jpg']).match, undefined);
  const duplicateName = { ...imageDirs, 'ISP46|0': { entries: [entry('a', 'D:/images')] } };
  assert.equal(find(['E:/a.jpg'], duplicateName).ambiguous, true);
  assert.equal(find(['C:/images/a.jpg'], duplicateName).match.imageDirKey, 'ISP6S|0');
  const duplicatePath = { ...imageDirs, 'ISP46|0': { entries: [entry('a')] } };
  assert.equal(find(['C:/images/a.jpg'], duplicatePath).ambiguous, true);
});

test('pending receiver supersedes, retries without reentrancy and completes each delivery once', () => {
  const completions = [], timers = new Set();
  let loading = true, indexed = false, calls = 0, receiver;
  receiver = receiverModule.createImageSyncReceiver({
    apply: () => {
      calls++;
      receiver.retry(); // Zustand callbacks run synchronously during a mutation.
      return indexed ? { accepted: true } : { accepted: false, reason: 'image-not-indexed' };
    },
    isLoading: () => loading,
    complete: (message, result) => completions.push([message.sequence, result]),
    schedule: (callback, delay) => { assert.equal(delay, 2000); timers.add(callback); return () => timers.delete(callback); },
  });
  receiver.receive(delivery(1));
  receiver.receive(delivery(2));
  assert.deepEqual(completions, [[1, { accepted: false, reason: 'superseded' }]]);
  assert.equal(timers.size, 1);
  indexed = true;
  receiver.retry();
  receiver.retry();
  assert.equal(calls, 3);
  assert.deepEqual(completions.at(-1), [2, { accepted: true }]);
  assert.equal(timers.size, 0);
  receiver.receive(delivery(2));
  assert.equal(completions.at(-1)[1].reason, 'stale-sequence');
  receiver.receive(delivery(3, undefined, 'luxe-self'));
  assert.equal(completions.at(-1)[1].reason, 'invalid-message');
  receiver.dispose();
});

test('scan grace expires and local selection/disposal cancel stale pending requests', () => {
  for (const action of ['timeout', 'localSelection', 'dispose']) {
    const completions = [];
    let expire;
    const receiver = receiverModule.createImageSyncReceiver({
      apply: () => ({ accepted: false, reason: 'image-not-indexed' }), isLoading: () => true,
      complete: (_, result) => completions.push(result),
      schedule: (callback) => { expire = callback; return () => {}; },
    });
    receiver.receive(delivery(1));
    if (action === 'timeout') expire(); else receiver[action]();
    receiver.retry();
    assert.equal(completions.length, 1);
    assert.equal(completions[0].reason, { timeout: 'image-not-indexed', localSelection: 'local-selection', dispose: 'listener-stopped' }[action]);
    receiver.dispose();
  }
});

function serviceHarness({ failRegistration = false } = {}) {
  const { useMtkStore } = loadModule('../src/stores/mtkStore.ts');
  const completions = [], loads = [], published = [];
  let receive, activeSubscriptions = 0;
  const subscribe = useMtkStore.subscribe;
  useMtkStore.subscribe = (...args) => {
    activeSubscriptions++;
    const stop = subscribe(...args);
    return () => { activeSubscriptions--; stop(); };
  };
  const service = loadModule('../src/services/imageSyncService.ts', {
    '@/ipc/imageSync': {
      listenForSelection: async (callback) => { if (failRegistration) throw new Error('unavailable'); receive = callback; return () => { receive = null; }; },
      completeSelection: async (id, result) => completions.push({ id, ...result }),
      publishSelection: async (path) => published.push(path),
    },
    '@/ipc/imageScan': { loadImageToml: (path) => { const load = { path, ...deferred() }; loads.push(load); return load.promise; } },
    '@/locales/i18n': { i18n: { t: (key) => key } },
    '@/stores/mtkStore': { useMtkStore },
    '@/views/mtk/ispTabs': loadModule('../src/views/mtk/ispTabs.ts'),
    './imageSyncMatching': matching,
    './imageSyncReceiver': receiverModule,
  });
  return { ...service, useMtkStore, completions, loads, published,
    receive: (message) => receive(message), subscriptions: () => activeSubscriptions };
}

test('service ACK reports actual mutation, retains ToneMap route and never echoes remote input', async () => {
  const h = serviceHarness();
  const store = h.useMtkStore.getState();
  store.setImageDir('ISP6S', 0, { dir: 'C:/images', entries: [entry('a'), entry('b')], status: 'done' });
  store.setCurrentTab(1);
  let navigations = 0;
  const stop = await h.startImageSyncListener(() => { navigations++; });
  h.receive(delivery(1, 'C:/images/b.jpg'));
  assert.equal(h.useMtkStore.getState().imageDir['ISP6S|0'].current, 1);
  assert.equal(h.useMtkStore.getState().imageSelection['ISP6S|1'], 'C:/images/b.jpg');
  assert.equal(h.useMtkStore.getState().mtk.current_tab, 1);
  assert.equal(h.completions[0].accepted, true);
  assert.equal(navigations, 1);
  assert.equal(h.published.length, 0);
  h.loads[0].resolve({ BV: '9' });
  await tick();
  assert.deepEqual(h.useMtkStore.getState().imageDir['ISP6S|0'].tomlData, { BV: '9' });
  stop();
  assert.equal(h.subscriptions(), 0);
});

test('TOML completions cannot overwrite A -> B -> A or a later local selection', async () => {
  const h = serviceHarness();
  const store = h.useMtkStore.getState();
  store.setImageDir('ISP6S', 0, { dir: 'C:/images', entries: [entry('a'), entry('b')], status: 'done' });
  const stop = await h.startImageSyncListener();
  h.receive(delivery(1));
  h.receive(delivery(2, 'C:/images/b.jpg'));
  h.receive(delivery(3));
  h.loads[0].resolve({ old: 'a' });
  h.loads[1].reject(new Error('stale b'));
  await tick();
  assert.deepEqual(h.useMtkStore.getState().imageDir['ISP6S|0'].tomlData, {});
  assert.equal(h.useMtkStore.getState().imageDir['ISP6S|0'].status, 'loading');
  store.setImageDir('ISP46', 0, { dir: 'D:/images', entries: [], status: 'scanning' });
  h.loads[2].resolve({ current: 'a' });
  await tick();
  assert.deepEqual(h.useMtkStore.getState().imageDir['ISP6S|0'].tomlData, { current: 'a' });
  h.receive(delivery(4));
  store.setImageSelection('ISP6S|0', 'C:/images/a.jpg'); // Same path, new user intent.
  store.setImageDir('ISP6S', 0, { tomlData: { local: 'a' }, status: 'done' });
  h.loads[3].resolve({ stale: 'remote' });
  await tick();
  assert.deepEqual(h.useMtkStore.getState().imageDir['ISP6S|0'].tomlData, { local: 'a' });
  stop();
});

test('pending remote selection cannot override a local click and registration failures do not leak', async () => {
  const h = serviceHarness();
  const store = h.useMtkStore.getState();
  store.setImageDir('ISP6S', 0, { dir: 'C:/images', entries: [], status: 'scanning' });
  const stop = await h.startImageSyncListener();
  h.receive(delivery(1));
  await h.publishImageSelection('C:/images/b.jpg');
  store.setImageDir('ISP6S', 0, { entries: [entry('a'), entry('b')], current: 1, status: 'done' });
  assert.equal(h.completions[0].reason, 'local-selection');
  assert.equal(h.useMtkStore.getState().imageDir['ISP6S|0'].current, 1);
  assert.equal(h.loads.length, 0);
  stop();
  const failed = serviceHarness({ failRegistration: true });
  await assert.rejects(failed.startImageSyncListener(), /unavailable/);
  assert.equal(failed.subscriptions(), 0);
});

test('invalid workspace tabs reject without navigation or mutation', async () => {
  const h = serviceHarness();
  h.useMtkStore.getState().setImageDir('ISP6S', 99, { entries: [entry('a')], status: 'done' });
  const stop = await h.startImageSyncListener();
  h.receive(delivery(1));
  assert.equal(h.completions[0].reason, 'image-not-indexed');
  assert.equal(h.useMtkStore.getState().mtk.current_tab, 0);
  stop();
});

const localeCodes = ['zh_CN', 'zh_TW', 'en_US', 'ja_JP', 'tr_TR'];
const bundles = Object.fromEntries(localeCodes.map((locale) => [locale,
  JSON.parse(readFileSync(new URL(`../src-tauri/resources/translations/${locale}.json`, import.meta.url), 'utf8'))]));

test('sync labels have the same keys and placeholders in all five languages with intact Unicode', () => {
  const keys = Object.keys(bundles.zh_CN).filter((key) => key.startsWith('image_sync.')).sort();
  assert.ok(keys.length > 15);
  assert.match(bundles.zh_CN['image_sync.title'], /图片联动/);
  assert.match(bundles.ja_JP['image_sync.title'], /画像/);
  assert.match(bundles.tr_TR['image_sync.title'], /görüntü/);
  for (const bundle of Object.values(bundles)) {
    assert.deepEqual(Object.keys(bundle).filter((key) => key.startsWith('image_sync.')).sort(), keys);
    for (const key of keys) {
      assert.ok(bundle[key].trim());
      assert.doesNotMatch(bundle[key], /\?{2,}|\uFFFD/);
      assert.deepEqual(bundle[key].match(/\{\{\w+\}\}/g), bundles.zh_CN[key].match(/\{\{\w+\}\}/g));
    }
  }
});

async function pluginUiHarness(update = async () => ({ available: false, version: '0.1.4', path: null })) {
  const nodes = new Map(['h1', '#path', '#status', '#connection', '#previous', '#next', '#update', '#update-status'].map((key) => [key, {}]));
  const events = {}, windowEvents = {}, commands = [];
  const window = {
    addEventListener: (name, callback) => { windowEvents[name] = callback; },
    __TAURI__: {
      window: { getCurrentWindow: () => ({ setTitle: async () => {} }) },
      event: { listen: async (name, callback) => { events[name] = callback; return () => { delete events[name]; }; } },
      core: { invoke: async (command, args) => {
        commands.push([command, args]);
        if (command === 'get_all_locale_bundles') return bundles;
        if (command === 'update_plugin') return update(args);
        if (command === 'get_bridge_state') return {
          snapshot: { files: ['C:/a.jpg', 'C:/b.jpg'], currentPath: 'C:/a.jpg' },
          connected: true, pendingSequence: 1,
        };
      } },
    },
  };
  runInNewContext(readFileSync(new URL('../plugins/luxe-image-sync/native/ui/bridge.js', import.meta.url), 'utf8'), {
    window, document: { querySelector: (key) => nodes.get(key), documentElement: {} },
    navigator: { language: 'en-US' }, console,
  });
  await tick();
  return { nodes, commands, windowEvents, emit: (name, payload) => events[name]({ payload }) };
}

test('plugin displays success only for ACK, rejects old ACK and disables unrelated LUXE paths', async () => {
  const h = await pluginUiHarness();
  assert.equal(h.nodes.get('#status').textContent, bundles.en_US['image_sync.pending']);
  h.emit('luxe-sync-pending', 2);
  h.emit('luxe-sync-result', { sequence: 1, accepted: true });
  assert.equal(h.nodes.get('#status').textContent, bundles.en_US['image_sync.pending']);
  h.emit('luxe-sync-result', { sequence: 2, accepted: false, reason: 'image-not-indexed' });
  assert.match(h.nodes.get('#status').textContent, /not indexed/);
  h.emit('luxe-sync-pending', 3);
  h.emit('luxe-sync-result', { sequence: 3, accepted: true });
  assert.equal(h.nodes.get('#status').textContent, bundles.en_US['image_sync.applied']);
  h.emit('luxe-selection', { imagePath: 'D:/unrelated.jpg' });
  assert.equal(h.nodes.get('#next').disabled, true);
  const before = h.commands.length;
  h.windowEvents.keydown({ key: 'd' });
  assert.equal(h.commands.length, before);
});

test('plugin routes only the active test-machine column and honors keyboard focus/modifiers', async () => {
  const h = await pluginUiHarness();
  h.emit('viewer-updated', {
    files: ['C:/a.jpg'], currentPath: 'C:/a.jpg', testMachineColumnPath: 'D:/test',
    testMachineFiles: ['D:/test/a.jpg', 'D:/test/b.jpg'], testMachineCurrentPath: 'D:/test/a.jpg',
  });
  h.windowEvents.keydown({ key: 'd', ctrlKey: true });
  assert.equal(h.commands.filter(([name]) => name === 'select_image').length, 0);
  h.windowEvents.keydown({ key: 'd', target: { closest: () => true } });
  assert.equal(h.commands.filter(([name]) => name === 'select_image').length, 0);
  let prevented = false;
  h.windowEvents.keydown({ key: 'd', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(h.commands.at(-1)[1].imagePath, 'D:/test/b.jpg');
  h.emit('luxe-connection', false);
  assert.equal(h.nodes.get('#previous').disabled, true);
});

test('plugin checks then downloads updates, blocks double clicks and explains host installation', async () => {
  const pending = deferred();
  const h = await pluginUiHarness(({ download }) => download
    ? Promise.resolve({ available: true, version: '0.1.5', path: 'C:/data/updates/plugin.hvp' })
    : pending.promise);
  const button = h.nodes.get('#update');
  const first = button.onclick();
  assert.equal(button.disabled, true);
  await button.onclick();
  assert.equal(h.commands.filter(([name]) => name === 'update_plugin').length, 1);
  pending.resolve({ available: true, version: '0.1.5', path: null });
  await first;
  assert.match(button.textContent, /0.1.5/);
  assert.equal(button.disabled, false);
  await button.onclick();
  assert.equal(h.commands.at(-1)[1].download, true);
  assert.match(h.nodes.get('#update-status').textContent, /C:\/data\/updates\/plugin.hvp/);
  assert.match(h.nodes.get('#update-status').textContent, /HiViewer/);
});

test('missing test-machine row clears navigation and clearing the device restores host focus', async () => {
  const h = await pluginUiHarness();
  h.emit('viewer-updated', {
    sequence: 4, files: ['C:/reference.jpg'], currentPath: 'C:/reference.jpg', testMachineColumnPath: 'D:/device',
    testMachineFiles: ['D:/device/first.jpg'], testMachineCurrentPath: null,
  });
  assert.equal(h.nodes.get('#next').disabled, true);
  assert.equal(h.nodes.get('#path').textContent, bundles.en_US['image_sync.no_image']);
  h.emit('viewer-updated', {
    sequence: 5, files: ['C:/reference.jpg'], currentPath: 'C:/reference.jpg', testMachineColumnPath: null,
    testMachineFiles: [], testMachineCurrentPath: null,
  });
  assert.equal(h.nodes.get('#next').disabled, false);
  assert.equal(h.nodes.get('#path').textContent, 'C:/reference.jpg');
});

test('plugin update failures permit retry and do not change image sync connection', async () => {
  const h = await pluginUiHarness(async () => { throw new Error('catalog unavailable'); });
  await h.nodes.get('#update').onclick();
  assert.match(h.nodes.get('#update-status').textContent, /catalog unavailable/);
  assert.equal(h.nodes.get('#update').disabled, false);
  assert.equal(h.nodes.get('#next').disabled, false);
});
