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

test('image selection persists during loading, scanning preserves previous workspace', () => {
  const { useMtkStore } = loadModule('../src/stores/mtkStore.ts');
  const store = useMtkStore.getState();
  store.setImageDir('ISP6S', 0, { dir: 'D:/images', entries: [entry('1.jpg'), entry('2.jpg')], current: 0, status: 'loading' });
  assert.equal(useMtkStore.getState().mtk.image_workspaces['ISP6S|0'].selected_image, 'D:/images/1.jpg');
  store.setImageDir('ISP6S', 0, { current: 1, status: 'loading' });
  const persisted = useMtkStore.getState().mtk;
  assert.equal(persisted.image_workspaces['ISP6S|0'].selected_image, 'D:/images/2.jpg');
  store.setImageDir('ISP6S', 0, { tomlData: { BV: '10' }, status: 'done' });
  assert.equal(useMtkStore.getState().mtk, persisted, 'TOML completion must not trigger another persistent write');
  store.setImageDir('ISP6S', 0, { dir: 'D:/other', entries: [], current: 0, status: 'scanning' });
  assert.equal(useMtkStore.getState().mtk, persisted, 'unfinished scans must not erase the saved selection');
  store.setImageDir('ISP6S', 0, { status: 'error' });
  assert.equal(useMtkStore.getState().mtk, persisted);
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
