import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

// Execute the real TypeScript modules with only the IPC boundary replaced.
function loadModule(relativePath, mocks = {}) {
  const url = new URL(relativePath, import.meta.url);
  const source = readFileSync(url, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const localRequire = createRequire(url);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(
    (id) => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id), module, module.exports,
  );
  return module.exports;
}

const turn = () => new Promise((resolve) => setImmediate(resolve));
const entry = (name) => ({ name, jpg_path: `D:/images/${name}`, toml_path: `D:/images/${name}.toml` });

test('image folder persists before scan completes and keeps its last selection on retry', () => {
  const { useMtkStore } = loadModule('../src/stores/mtkStore.ts');
  const store = useMtkStore.getState();
  store.setImageDir('ISP6S', 0, { dir: 'D:/images', entries: [], current: 0, status: 'scanning' });
  assert.deepEqual(useMtkStore.getState().mtk.image_workspaces['ISP6S|0'], {
    dir: 'D:/images', selected_image: null,
  });
  store.setImageDir('ISP6S', 0, { status: 'error' });
  assert.equal(useMtkStore.getState().mtk.image_workspaces['ISP6S|0'].dir, 'D:/images');
  store.setImageDir('ISP6S', 0, { dir: 'D:/images', entries: [entry('1.jpg'), entry('2.jpg')], current: 0, status: 'loading' });
  assert.equal(useMtkStore.getState().mtk.image_workspaces['ISP6S|0'].selected_image, 'D:/images/1.jpg');
  store.setImageDir('ISP6S', 0, { current: 1, status: 'loading' });
  const persisted = useMtkStore.getState().mtk;
  assert.equal(persisted.image_workspaces['ISP6S|0'].selected_image, 'D:/images/2.jpg');
  store.setImageDir('ISP6S', 0, { tomlData: { BV: '10' }, status: 'done' });
  assert.equal(useMtkStore.getState().mtk, persisted, 'TOML completion must not trigger another persistent write');
  store.setImageDir('ISP6S', 0, { dir: 'D:/images', entries: [], current: 0, status: 'scanning' });
  assert.equal(useMtkStore.getState().mtk, persisted, 'retrying the same folder keeps the saved selection');
  store.setImageDir('ISP6S', 0, { status: 'error' });
  assert.equal(useMtkStore.getState().mtk, persisted);
  store.setImageDir('ISP6S', 0, { dir: 'D:/other', entries: [], current: 0, status: 'scanning' });
  assert.deepEqual(useMtkStore.getState().mtk.image_workspaces['ISP6S|0'], {
    dir: 'D:/other', selected_image: null,
  });
});

test('startup hydrates both parameter paths and the DP path before parsing', () => {
  const { useMtkStore } = loadModule('../src/stores/mtkStore.ts');
  useMtkStore.getState().hydrate({
    current_isp: 1, current_tab: 0, outer_splitter: [], inner_splitter: [],
    cpp_path: 'D:/params/AE.cpp',
    cpp_paths: { 'ISP6S|0': 'D:/params/AE.cpp', 'ISP6S|1': 'D:/params/Tone.cpp' },
    debug_parser_path: 'D:/tools/DebugParser.exe',
    image_workspaces: { 'ISP6S|0': { dir: 'D:/images', selected_image: 'D:/images/2.jpg' } },
  });
  const state = useMtkStore.getState();
  assert.equal(state.imports['ISP6S|0'].filePath, 'D:/params/AE.cpp');
  assert.equal(state.imports['ISP6S|1'].filePath, 'D:/params/Tone.cpp');
  assert.equal(state.debugParserPath, 'D:/tools/DebugParser.exe');
  assert.equal(state.mtk.image_workspaces['ISP6S|0'].selected_image, 'D:/images/2.jpg');
});

test('startup accepts the legacy AE parameter path without cpp_paths', () => {
  const { useMtkStore } = loadModule('../src/stores/mtkStore.ts');
  useMtkStore.getState().hydrate({
    current_isp: 1, current_tab: 0, outer_splitter: [], inner_splitter: [],
    cpp_path: 'D:/params/AE.cpp',
  });
  assert.equal(useMtkStore.getState().imports['ISP6S|0'].filePath, 'D:/params/AE.cpp');
});

test('DP accepts renamed executables and flushes the selected path before reload', async () => {
  const { isDebugParserExecutable } = loadModule('../src/views/mtk/debugParserPath.ts');
  const { useMtkStore } = loadModule('../src/stores/mtkStore.ts');
  const selected = 'D:/tools/DP_Parser.EXE';
  assert.equal(isDebugParserExecutable(selected), true);
  assert.equal(isDebugParserExecutable('D:/tools/DP_Parser.lnk'), false);
  const calls = [];
  let saved;
  const io = loadModule('../src/ipc/stateIo.ts', { './client': {
    call: async (command, args) => {
      calls.push(command);
      if (command === 'save_state_section') saved = structuredClone(args.value);
    },
  } });
  useMtkStore.getState().setInnerSplit([32.2005007422, 67.7994992578]);
  const unsubscribe = useMtkStore.subscribe((next, previous) => {
    if (next.mtk !== previous.mtk) void io.saveStateSection('mtk', next.mtk);
  });
  useMtkStore.getState().setDebugParserPath(selected);
  await io.saveStateSection('mtk', useMtkStore.getState().mtk);
  await io.flushStateNow();
  useMtkStore.getState().setDebugParserPath(selected);
  await io.saveStateSection('mtk', useMtkStore.getState().mtk);
  await io.flushStateNow();
  unsubscribe();
  assert.deepEqual(calls, [
    'save_state_section', 'save_state_section', 'flush_state_now',
    'save_state_section', 'flush_state_now',
  ]);
  const reopened = loadModule('../src/stores/mtkStore.ts').useMtkStore;
  reopened.getState().hydrate(saved);
  assert.equal(reopened.getState().debugParserPath, selected);
  assert.deepEqual(reopened.getState().mtk.inner_splitter, [32.2005007422, 67.7994992578]);
});

test('DP and AE/Tone parameter paths persist independently and duplicate values stay stable', () => {
  const { useMtkStore } = loadModule('../src/stores/mtkStore.ts');
  const store = useMtkStore.getState();
  store.setDebugParserPath('D:/tools/DebugParser.exe');
  store.setCppPath('D:/params/AE.cpp', 'ISP6S', 0);
  store.setCppPath('D:/params/Tone.cpp', 'ISP6S', 1);
  const saved = useMtkStore.getState().mtk;
  assert.equal(saved.debug_parser_path, 'D:/tools/DebugParser.exe');
  assert.deepEqual(saved.cpp_paths, { 'ISP6S|0': 'D:/params/AE.cpp', 'ISP6S|1': 'D:/params/Tone.cpp' });
  store.setCppPath('D:/params/Tone.cpp', 'ISP6S', 1);
  assert.equal(useMtkStore.getState().mtk, saved);
  store.setCppPath(null, 'ISP6S', 0);
  assert.equal(useMtkStore.getState().mtk.cpp_path, null);
  assert.equal(useMtkStore.getState().mtk.cpp_paths['ISP6S|1'], 'D:/params/Tone.cpp');
});

test('state writes and forced flush execute in submission order', async () => {
  const calls = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const io = loadModule('../src/ipc/stateIo.ts', { './client': {
    call: async (cmd, args) => {
      calls.push([cmd, args?.section]);
      if (args?.section === 'mtk') await gate;
    },
  } });
  const first = io.saveStateSection('mtk', {});
  const second = io.saveStateSection('last_route', '/mtk');
  const flush = io.flushStateNow();
  const later = io.saveStateSection('settings', {});
  await turn();
  assert.deepEqual(calls, [['save_state_section', 'mtk']]);
  release();
  await Promise.all([first, second, flush, later]);
  assert.deepEqual(calls, [
    ['save_state_section', 'mtk'], ['save_state_section', 'last_route'],
    ['flush_state_now', undefined], ['save_state_section', 'settings'],
  ]);
});

test('failed save is reported and a subsequent save can recover the queue', async () => {
  const calls = [];
  const io = loadModule('../src/ipc/stateIo.ts', { './client': {
    call: async (cmd, args) => {
      calls.push(cmd);
      if (args?.value === 'fail') throw new Error('disk unavailable');
    },
  } });
  await assert.rejects(io.saveStateSection('last_route', 'fail'), /disk unavailable/);
  await assert.rejects(io.flushStateNow(), /disk unavailable/);
  await io.saveStateSection('last_route', '/mtk');
  await io.flushStateNow();
  assert.deepEqual(calls, ['save_state_section', 'save_state_section', 'flush_state_now']);
});
