import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

function loadModule(relativePath, mocks = {}, globals = {}, source) {
  const url = new URL(relativePath, import.meta.url);
  const { outputText } = ts.transpileModule(source ?? readFileSync(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const localRequire = createRequire(url);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), outputText)(
    (id) => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id), module, module.exports, ...Object.values(globals),
  );
  return module.exports;
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const entry = (name, dir = 'C:/images') => ({ name, jpg_path: `${dir}/${name}.jpg`, toml_path: `${dir}/${name}.toml` });
const summary = { processed: 2, direct: 1, fallback: 1, partial: 0, skipped: 0, failed: 0, total: 2 };
const preparedSummary = { total: 2, created: 1, replaced: 0, retained: 1, cached: 0, unavailable: 0, failed: 0, partial: 1 };

function harness() {
  const { useMtkStore } = loadModule('../src/stores/mtkStore.ts');
  const parses = [], scans = [], loads = [], replacements = [], preparations = [];
  const service = loadModule('../src/services/imageExifService.ts', {
    '@/stores/mtkStore': { useMtkStore },
    '@/ipc/imageScan': {
      parseImageExif: (parser, dir, progress) => {
        const task = { parser, dir, progress, ...deferred() };
        parses.push(task); return task.promise;
      },
      prepareImageMetadata: (dir, progress) => { const task = { dir, progress, ...deferred() }; preparations.push(task); return task.promise; },
      replaceImageMetadata: (dir, paths, progress) => { const task = { dir, paths, progress, ...deferred() }; replacements.push(task); return task.promise; },
      scanImageDir: (dir) => { const task = { dir, ...deferred() }; scans.push(task); return task.promise; },
      loadImageToml: (path) => { const task = { path, ...deferred() }; loads.push(task); return task.promise; },
    },
  });
  useMtkStore.getState().setImageDir('ISP6S', 0, {
    dir: 'C:/images', entries: [entry('a'), entry('b')], current: 0,
    metadataRevision: 0, status: 'done',
  });
  return { ...service, useMtkStore, parses, scans, loads, replacements, preparations,
    start: (progress, workspaceKey, signal) => service.parseWorkspaceImageExif('ISP6S', 0, 'C:/tools/DebugParser.exe', progress, workspaceKey, signal),
  };
}
async function finishScan(h, rows = [entry('a'), entry('b')]) {
  h.parses[0].resolve(summary);
  await tick();
  h.scans[0].resolve(rows);
  await tick();
  return rows;
}

test('shared EXIF completion survives a disposed view and preserves the latest selection', async () => {
  const h = harness();
  let mounted = true;
  const notices = [];
  const pending = h.start((p) => { if (mounted) notices.push(p); });
  await tick();
  mounted = false; // AE Basic unmounts while its native/DP job continues.
  const store = h.useMtkStore.getState();
  store.setCurrentTab(1);
  store.setImageDir('ISP6S', 0, { current: 1, status: 'done' });
  h.parses[0].progress({ stage: 'DP', completed: 1, total: 2 });
  const rows = await finishScan(h);
  assert.equal(h.loads[0].path, rows[1].toml_path);
  assert.equal(h.useMtkStore.getState().imageDir['ISP6S|0'].metadataRevision, 1);
  h.loads[0].resolve({ fresh: 'b' });
  await pending;
  const image = h.useMtkStore.getState().imageDir['ISP6S|0'];
  assert.equal(image.entries, rows);
  assert.equal(image.current, 1);
  assert.equal(image.status, 'done');
  assert.deepEqual(image.tomlData, { fresh: 'b' });
  assert.equal(notices.length, 0);
});

test('paired selection intent cannot strand the metadata load in loading', async () => {
  const h = harness();
  const pending = h.start();
  await tick();
  await finishScan(h);
  const before = h.useMtkStore.getState();
  const loadRevision = before.imageDir['ISP6S|0'].loadRevision;
  before.setImageSelection('ISP6S|1', entry('a').jpg_path);
  assert.equal(h.useMtkStore.getState().imageDir['ISP6S|0'].loadRevision, loadRevision);
  h.loads[0].resolve({ complete: 'yes' });
  await pending;
  assert.equal(h.useMtkStore.getState().imageDir['ISP6S|0'].status, 'done');
  assert.deepEqual(h.useMtkStore.getState().imageDir['ISP6S|0'].tomlData, { complete: 'yes' });
});

test('shared refresh preserves the initiating workspace selection', async () => {
  const h = harness();
  h.useMtkStore.getState().setImageSelection('ISP6S|1', entry('b').jpg_path);
  const pending = h.start(undefined, 'ISP6S|1');
  await tick();
  await finishScan(h);
  assert.equal(h.loads[0].path, entry('b').toml_path);
  h.loads[0].resolve({ selected: 'b' });
  await pending;
  const image = h.useMtkStore.getState().imageDir['ISP6S|0'];
  assert.equal(image.current, 1);
  assert.deepEqual(image.tomlData, { selected: 'b' });
});

test('metadata revision changes for dataset refreshes but not selection-only loads', () => {
  const h = harness();
  const before = h.useMtkStore.getState().imageDir['ISP6S|0'].metadataRevision;
  h.useMtkStore.getState().setImageDir('ISP6S', 0, { current: 1, status: 'loading' });
  assert.equal(h.useMtkStore.getState().imageDir['ISP6S|0'].metadataRevision, before);
  h.useMtkStore.getState().setImageDir('ISP6S', 0, {
    entries: [entry('replacement')], current: 0, status: 'done',
  });
  assert.equal(h.useMtkStore.getState().imageDir['ISP6S|0'].metadataRevision, before + 1);
});

test('a real A -> B -> A load supersedes the older EXIF completion', async () => {
  const h = harness();
  const pending = h.start();
  await tick();
  await finishScan(h);
  const store = h.useMtkStore.getState();
  store.setImageDir('ISP6S', 0, { current: 1, status: 'loading' });
  store.setImageDir('ISP6S', 0, { current: 0, status: 'done', tomlData: { local: 'a' } });
  h.loads[0].resolve({ stale: 'a' });
  await pending;
  assert.deepEqual(h.useMtkStore.getState().imageDir['ISP6S|0'].tomlData, { local: 'a' });
  assert.equal(h.useMtkStore.getState().imageDir['ISP6S|0'].status, 'done');
});

test('directory A -> B -> A does not reuse an obsolete EXIF index snapshot', async () => {
  const h = harness();
  const pending = h.start();
  await tick();
  const store = h.useMtkStore.getState();
  store.setImageDir('ISP6S', 0, { dir: 'D:/other', entries: [entry('other', 'D:/other')], status: 'done' });
  const replacement = [entry('new')];
  store.setImageDir('ISP6S', 0, { dir: 'C:/images', entries: replacement, status: 'done' });
  h.parses[0].resolve(summary);
  await pending;
  assert.equal(h.scans.length, 0);
  assert.equal(h.useMtkStore.getState().imageDir['ISP6S|0'].entries, replacement);
});

test('live jobs are deduplicated, replay progress and release their slot after failure', async () => {
  const h = harness();
  const firstUpdates = [];
  const first = h.start((p) => firstUpdates.push(p));
  await tick();
  h.parses[0].progress({ stage: 'DP', completed: 1, total: 2 });
  const updates = [];
  const second = h.start((p) => updates.push(p));
  assert.equal(first, second);
  assert.equal(h.parses.length, 1);
  assert.deepEqual(firstUpdates, [{ stage: 'DP', completed: 1, total: 2 }]);
  assert.deepEqual(updates, [{ stage: 'DP', completed: 1, total: 2 }]);
  h.parses[0].reject(new Error('parser unavailable'));
  await assert.rejects(first, /parser unavailable/);
  const retry = h.start();
  await tick();
  assert.equal(h.parses.length, 2);
  h.parses[1].resolve(summary);
  await tick();
  h.scans[0].resolve([]);
  await retry;
  assert.equal(h.useMtkStore.getState().imageDir['ISP6S|0'].status, 'done');
});

test('a disposed progress subscriber detaches while the shared job continues', async () => {
  const h = harness();
  const controller = new AbortController();
  const updates = [];
  const pending = h.start((progress) => updates.push(progress), undefined, controller.signal);
  await tick();
  controller.abort();
  h.parses[0].progress({ stage: 'DP', completed: 1, total: 2 });
  assert.deepEqual(updates, []);
  h.parses[0].resolve(summary);
  await tick();
  h.scans[0].resolve([]);
  await pending;
});

test('a newly selected directory supersedes an old DP generation without allowing stale publication', async () => {
  const h = harness();
  const old = h.start(); await tick();
  const replacement = [entry('fresh', 'D:/new')];
  h.useMtkStore.getState().setImageDir('ISP6S', 0, { dir: 'D:/new', entries: replacement, status: 'done' });
  h.parses[0].resolve(summary); await old;
  assert.equal(h.scans.length, 0, 'the old parser completion must not rescan the replacement directory');
  assert.equal(h.useMtkStore.getState().imageDir['ISP6S|0'].dir, 'D:/new');
});

test('explicit native replacement targets selected paths, preserves current selection and excludes DP writes', async () => {
  const h = harness(); const progress = [];
  const pending = h.replaceWorkspaceImageMetadata('ISP6S', 0, [entry('a').jpg_path, entry('a').jpg_path], (value) => progress.push(value));
  assert.deepEqual(h.replacements[0].paths, [entry('a').jpg_path]);
  await assert.rejects(h.start(), (error) => error.code === 'busy');
  h.useMtkStore.getState().setImageDir('ISP6S', 0, { current: 1 });
  h.replacements[0].progress({ stage: 'JPEG', completed: 1, total: 1 });
  assert.equal(progress.length, 1);
  const rows = [entry('a'), entry('b')];
  h.replacements[0].resolve({ entries: rows, summary: { ...preparedSummary, replaced: 1 } }); await tick();
  assert.equal(h.loads[0].path, entry('b').toml_path);
  assert.equal(progress.at(-1).stage, 'REFRESH');
  h.loads[0].resolve({ fresh: 'jpeg-replaced-toml' });
  const result = await pending;
  assert.equal(result.summary.replaced, 1);
  assert.equal(h.useMtkStore.getState().imageDir['ISP6S|0'].metadataRevision, 1);
  assert.equal(h.useMtkStore.getState().imageDir['ISP6S|0'].current, 1);
  h.replacements[0].progress({ stage: 'JPEG', completed: 0, total: 1 }); assert.equal(progress.length, 2);
});

test('native replacement rejects out-of-index paths and live DP work without mutating any files', async () => {
  const h = harness();
  const parsing = h.start(); await tick();
  await assert.rejects(h.replaceWorkspaceImageMetadata('ISP6S', 0, []), (error) => error.code === 'busy');
  h.parses[0].reject(new Error('stopped')); await assert.rejects(parsing);
  await assert.rejects(h.replaceWorkspaceImageMetadata('ISP6S', 0, ['D:/outside/a.jpg']), (error) => error.code === 'changed');
  assert.equal(h.replacements.length, 0);
  await assert.rejects(h.parseWorkspaceImageExif('ISP6S', 0, null), (error) => error.code === 'parser_required');
  assert.equal(h.parses.length, 1, 'missing DP must not silently trigger native writes');
});

test('a failed replacement still refreshes partial changes and releases its slot for retry', async () => {
  const h = harness();
  const pending = h.replaceWorkspaceImageMetadata('ISP6S', 0, []);
  h.replacements[0].reject(new Error('permission denied')); await tick();
  h.scans[0].resolve([]);
  await assert.rejects(pending, /permission denied/);
  assert.equal(h.useMtkStore.getState().imageDir['ISP6S|0'].metadataRevision, 1);
  await assert.rejects(h.replaceWorkspaceImageMetadata('ISP6S', 0, []), (error) => error.code === 'empty');
});

test('native replacement completion cannot rescan or overwrite a replacement workspace', async () => {
  const h = harness();
  const pending = h.replaceWorkspaceImageMetadata('ISP6S', 0, []);
  const replacement = [entry('replacement', 'D:/new')];
  h.useMtkStore.getState().setImageDir('ISP6S', 0, { dir: 'D:/new', entries: replacement, tomlData: { local: 'new' } });
  h.replacements[0].resolve({ entries: [entry('a')], summary: preparedSummary }); await pending;
  assert.equal(h.scans.length, 0);
  assert.equal(h.useMtkStore.getState().imageDir['ISP6S|0'].entries, replacement);
  assert.deepEqual(h.useMtkStore.getState().imageDir['ISP6S|0'].tomlData, { local: 'new' });
});

test('native replacement keeps the directory refresh but detaches an aborted view subscriber', async () => {
  const h = harness(); const controller = new AbortController(); const progress = [];
  const pending = h.replaceWorkspaceImageMetadata('ISP6S', 0, [], value => progress.push(value), undefined, controller.signal);
  assert.deepEqual(h.replacements[0].paths, [], 'an empty selection explicitly means this directory');
  h.replacements[0].progress({ stage: 'JPEG', completed: 1, total: 2 });
  controller.abort();
  h.replacements[0].progress({ stage: 'JPEG', completed: 2, total: 2 });
  h.replacements[0].resolve({ entries: [entry('a')], summary: preparedSummary }); await tick();
  h.loads[0].resolve({ fresh: 'native' }); await pending;
  assert.equal(progress.length, 1);
  assert.equal(h.useMtkStore.getState().imageDir['ISP6S|0'].metadataRevision, 1);
});

test('DP progress reaches refresh before rescanning and ignores delayed channel messages', async () => {
  const h = harness(); const progress = [];
  const pending = h.start(value => progress.push(value)); await tick();
  for (const stage of ['QUEUED', 'PREPARE', 'DP', 'TOML']) h.parses[0].progress({ stage, completed: 0, total: 0 });
  h.parses[0].resolve(summary); await tick();
  assert.equal(progress.at(-1).stage, 'REFRESH');
  h.parses[0].progress({ stage: 'DP', completed: 0, total: 0 });
  assert.equal(progress.at(-1).stage, 'REFRESH', 'a delayed tool event cannot replace the refresh stage');
  h.scans[0].resolve([]); await pending;
  h.parses[0].progress({ stage: 'DP', completed: 0, total: 0 });
  assert.equal(progress.length, 5);
});

test('folder import prepares every image before publication and shares its progress across AE/Tone navigation', async () => {
  const h = harness();
  const pending = h.prepareWorkspaceImageDirectory('ISP6S', 0, 'C:/images', entry('b').jpg_path);
  assert.equal(h.useMtkStore.getState().imageDir['ISP6S|0'].metadataPreparing, true);
  assert.deepEqual(h.useMtkStore.getState().imageDir['ISP6S|0'].entries, []);
  assert.equal(h.prepareWorkspaceImageDirectory('ISP6S', 0, 'C:/images'), pending, 'deduplicate same live import');
  await tick(); assert.equal(h.preparations.length, 1); assert.equal(h.loads.length, 0);
  await assert.rejects(h.start(), (error) => error.code === 'empty' || error.code === 'busy');
  h.useMtkStore.getState().setCurrentTab(1); // initiating component has unmounted, service still owns completion
  h.preparations[0].progress({ stage: 'JPEG', completed: 1, total: 2 });
  assert.equal(h.useMtkStore.getState().imageDir['ISP6S|0'].preparationProgress.completed, 1);
  const rows = [entry('a'), entry('b')]; h.preparations[0].resolve({ entries: rows, summary: preparedSummary }); await tick();
  assert.equal(h.loads[0].path, entry('b').toml_path);
  h.loads[0].resolve({ selected: 'toml-only' }); await pending;
  const image = h.useMtkStore.getState().imageDir['ISP6S|0'];
  assert.equal(image.entries, rows); assert.equal(image.current, 1); assert.equal(image.status, 'done');
  assert.equal(image.metadataPreparing, false); assert.equal(image.preparationProgress, null);
  assert.equal(image.preparationSummary.created, 1);
  h.preparations[0].progress({ stage: 'JPEG', completed: 0, total: 2 });
  assert.equal(h.useMtkStore.getState().imageDir['ISP6S|0'].preparationProgress, null, 'late channel messages cannot reopen progress');
});

test('obsolete folder preparations and failures never republish into replacement datasets and can retry', async () => {
  const h = harness();
  const pending = h.prepareWorkspaceImageDirectory('ISP6S', 0, 'C:/images'); await tick();
  const replacement = [entry('x', 'D:/new')];
  h.useMtkStore.getState().setImageDir('ISP6S', 0, { dir: 'D:/new', entries: replacement,
    metadataPreparing: false, preparationProgress: null, status: 'done' });
  h.preparations[0].progress({ stage: 'JPEG', completed: 1, total: 2 });
  h.preparations[0].resolve({ entries: [entry('old')], summary: preparedSummary }); await pending;
  assert.equal(h.loads.length, 0); assert.equal(h.useMtkStore.getState().imageDir['ISP6S|0'].entries, replacement);
  const retry = h.prepareWorkspaceImageDirectory('ISP6S', 0, 'D:/new'); await tick();
  h.preparations[1].reject(new Error('folder unavailable')); await assert.rejects(retry, /unavailable/);
  assert.equal(h.useMtkStore.getState().imageDir['ISP6S|0'].metadataPreparing, false);
  const again = h.prepareWorkspaceImageDirectory('ISP6S', 0, 'D:/new'); await tick();
  h.preparations[2].resolve({ entries: [], summary: { ...preparedSummary, total: 0 } }); await again;
  assert.equal(h.useMtkStore.getState().imageDir['ISP6S|0'].status, 'error');
});

test('the real folder picker callback routes through shared preparation before reporting completion', async () => {
  const relative = '../src/views/mtk/MtkView.tsx';
  const text = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const source = ts.createSourceFile('MtkView.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const view = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'MtkView');
  const declaration = view.body.statements.find((node) => ts.isVariableStatement(node)
    && node.declarationList.declarations.some((decl) => decl.name.getText(source) === 'onImageDirChange'));
  assert.ok(declaration);
  const calls = [], notices = [], pending = deferred();
  const refs = { current: 0 };
  const { onImageDirChange } = loadModule(relative, {}, {
    useCallback: (callback) => callback, imageRequestId: refs, ispId: 'ISP6S', imageTabIdx: 0,
    prepareWorkspaceImageDirectory: (...args) => { calls.push(args); return pending.promise; },
    useMtkStore: { getState: () => ({ imageDir: { 'ISP6S|0': { dir: 'C:/images' } } }) },
    setToast: (notice) => notices.push(notice), t: (key) => key, ImageExifTaskError: class extends Error {},
  }, `${declaration.getText(source)}; exports.onImageDirChange = onImageDirChange;`);
  const result = onImageDirChange('C:/images', entry('b').jpg_path);
  assert.deepEqual(calls, [['ISP6S', 0, 'C:/images', entry('b').jpg_path]]);
  assert.equal(notices.length, 0);
  pending.resolve({ summary: preparedSummary }); await result;
  assert.equal(notices[0].title, 'image_exif.import.completed');
});

test('all five EXIF locales have matching keys and interpolation fields', () => {
  let expected;
  for (const locale of ['zh_CN', 'zh_TW', 'en_US', 'ja_JP', 'tr_TR']) {
    const bundle = JSON.parse(readFileSync(new URL(`../src-tauri/resources/translations/${locale}.json`, import.meta.url), 'utf8'));
    const keys = Object.keys(bundle).filter((key) => key.startsWith('image_exif.')).sort();
    const shape = keys.map((key) => [key, [...bundle[key].matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()]);
    if (expected) assert.deepEqual(shape, expected, locale); else expected = shape;
    for (const key of ['error.empty', 'error.busy', 'fallback_hint', 'unavailable',
      'source.jpeg', 'source.debug_parser', 'source.native_toml', 'source.native_merged', 'source.metadata_only', 'source.unknown_toml',
      'detail.field_count', 'ae_table.block', 'ae_table.all', 'ae_table.empty',
      'match.matched', 'match.missing_header', 'match.invalid_header', 'match.ambiguous', 'match.unknown', 'match.unrecorded',
      'identity.directory', 'identity.directory_layout', 'identity.payload', 'identity.toml', 'identity.unrecorded',
      'parse.empty', 'parse.version_only', 'parse.unsupported', 'parse.unavailable',
      'native.completed', 'native.failed', 'native.summary', 'progress_count', 'progress_active', 'progress_dp_hint',
      'overwrite.title', 'overwrite.confirm', 'overwrite.warning', 'overwrite.run', 'overwrite.cancel', 'overwrite.summary', 'error.changed', 'error.parser_required',
      'stage.JPEG', 'stage.EXIF', 'stage.DP', 'stage.TOML', 'stage.PREPARE', 'stage.QUEUED', 'stage.REFRESH',
      'import.completed', 'import.failed', 'import.summary', 'source.native_merged', 'source.metadata_only']) {
      assert.ok(bundle[`image_exif.${key}`], `${locale}:${key}`);
    }
    assert.equal(bundle['image_exif.action_title'].split('\n').length, 3, `${locale}: bounded multiline action hint`);
    assert.deepEqual([...bundle['image_exif.summary'].matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort(),
      ['processed', 'direct', 'fallback', 'skipped', 'failed', 'partial'].sort());
  }
});

// A tiny hook runner executes the actual EXIF component's loading effect. It
// does not replace file/revision logic with a separately maintained model.
function hookRunner() {
  const slots = [];
  let cursor = 0, effects = [], disposed = false, updatesAfterDispose = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState: (initial) => {
      const index = cursor++;
      slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, (next) => {
        if (disposed) updatesAfterDispose += 1;
        slots[index].value = typeof next === 'function' ? next(slots[index].value) : next;
      }];
    },
    useRef: (initial) => { const index = cursor++; return (slots[index] ??= { current: initial }); },
    useMemo: (compute, deps) => {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { value: compute(), deps };
      return slots[index].value;
    },
    useEffect: (effect, deps) => {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) effects.push(() => {
        slots[index]?.cleanup?.();
        slots[index] = { deps, cleanup: effect() };
      });
    },
  };
  hooks.useId = () => `exif-test-${cursor++}`;
  hooks.useLayoutEffect = hooks.useEffect;
  return { hooks, render(component, props) {
    cursor = 0; effects = [];
    const tree = component(props);
    effects.forEach((effect) => effect());
    return tree;
  }, dispose() {
    disposed = true;
    slots.forEach((slot) => slot?.cleanup?.());
  }, get updatesAfterDispose() { return updatesAfterDispose; } };
}
function exifDocument(value) {
  return { sections: [{ name: 'AE', fields: [{ key: 'AE_TAG_CWV', value }] }],
    ae_tables: [], modules: [], source: { kind: 'jpeg', parser: 'native', path: 'C:/images/a.jpg' }, needs_fallback: false };
}
function shownFields(node) {
  if (!node || typeof node !== 'object') return [];
  if (node.type?.name === 'ExifRows') return node.props.fields;
  const children = node.props?.children;
  return (Array.isArray(children) ? children.flat(Infinity) : [children]).flatMap(shownFields);
}

test('an open EXIF detail reloads the same path on revision and ignores late old results', async () => {
  const runner = hookRunner();
  const loads = [];
  const jsx = (type, props) => ({ type, props });
  const { ExifTable } = loadModule('../src/views/mtk/isp6s/TablePane/ExifTable.tsx', {
    react: runner.hooks,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-i18next': { useTranslation: () => ({ t: (key) => key }) },
    '@fluentui/react-icons': {},
    '@fluentui/react-components': { Button: 'Button', Input: 'Input', Tab: 'Tab', TabList: 'TabList' },
    './exifPresentation': loadModule('../src/views/mtk/isp6s/TablePane/exifPresentation.ts'),
    './ExifRows': { ExifRows: function ExifRows() {} },
    './ExifMetadataViews': { ExifAeTables: 'ExifAeTables', ExifDetail: 'ExifDetail', ExifSource: 'ExifSource' },
    './MetadataProgress': { MetadataProgress: 'MetadataProgress' },
    '@/ipc/imageScan': { loadImageExif: (path, progress) => { const task = { path, progress, ...deferred() }; loads.push(task); return task.promise; } },
  }, { window: { localStorage: { getItem: () => null, setItem: () => {} } } });
  const props = { tomlPath: 'C:/images/a.toml', revision: 0 };
  runner.render(ExifTable, props);
  runner.render(ExifTable, props);
  assert.equal(loads.length, 1);
  runner.render(ExifTable, { ...props, revision: 1 });
  assert.equal(loads.length, 2);
  loads[1].resolve(exifDocument('fresh'));
  await tick();
  assert.equal(shownFields(runner.render(ExifTable, { ...props, revision: 1 }))[0].value, 'fresh');
  loads[0].resolve(exifDocument('old'));
  await tick();
  assert.equal(shownFields(runner.render(ExifTable, { ...props, revision: 1 }))[0].value, 'fresh');
});

function nodesOfType(node, type) {
  if (!node || typeof node !== 'object') return [];
  const children = node.props?.children;
  return [...(node.type === type ? [node] : []),
    ...(Array.isArray(children) ? children.flat(Infinity) : [children]).flatMap((child) => nodesOfType(child, type))];
}
function exifUiHarness() {
  const runner = hookRunner(), loads = [];
  const jsx = (type, props) => ({ type, props });
  const { ExifTable } = loadModule('../src/views/mtk/isp6s/TablePane/ExifTable.tsx', {
    react: runner.hooks,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-i18next': { useTranslation: () => ({ t: (key) => key }) },
    '@fluentui/react-icons': {},
    '@fluentui/react-components': { Button: 'Button', Input: 'Input', Tab: 'Tab', TabList: 'TabList' },
    './exifPresentation': loadModule('../src/views/mtk/isp6s/TablePane/exifPresentation.ts'),
    './ExifRows': { ExifRows: function ExifRows() {} },
    './ExifMetadataViews': { ExifAeTables: 'ExifAeTables', ExifDetail: 'ExifDetail', ExifSource: 'ExifSource' },
    './MetadataProgress': { MetadataProgress: 'MetadataProgress' },
    '@/ipc/imageScan': { loadImageExif: (path, progress) => { const task = { path, progress, ...deferred() }; loads.push(task); return task.promise; } },
  }, { window: { localStorage: { getItem: () => null, setItem: () => {} } } });
  const props = { tomlPath: 'C:/images/a.toml', revision: 0 };
  return { runner, loads, props, render: (next = props) => runner.render(ExifTable, next) };
}

test('EXIF module tabs remain visible during search and Detail filters module signatures', async () => {
  const h = exifUiHarness();
  h.render();
  const document = exifDocument('7');
  document.modules = [
    { module: 'AE', header: 'AE_6_11_0.h', signature: '0xE28FA520', status: 'matched', parse_status: 'decoded', decoded_fields: 1 },
    { module: 'Sensor', header: 'SENSOR_6_0_0.h', signature: '0xBE629B07', status: 'matched', parse_status: 'version_only', decoded_fields: 0 },
  ];
  h.loads[0].resolve(document);
  await tick();
  const tabNames = (tree) => nodesOfType(tree, 'Tab').map((node) => node.props.value);
  let tree = h.render();
  assert.deepEqual(tabNames(tree), ['AE', 'Detail']);
  nodesOfType(tree, 'Input')[0].props.onChange(null, { value: 'BE629B07' });
  tree = h.render();
  assert.deepEqual(tabNames(tree), ['AE', 'Detail'], 'search cannot hide navigation');
  nodesOfType(tree, 'TabList')[0].props.onTabSelect(null, { value: 'Detail' });
  tree = h.render();
  assert.equal(nodesOfType(tree, 'ExifDetail')[0].props.modules[0].module, 'Sensor');
  assert.equal(nodesOfType(tree, 'ExifDetail')[0].props.modules.length, 1);
  assert.equal(nodesOfType(tree, 'ExifSource')[0].props.document.source.kind, 'jpeg');
});

test('an EXIF document with only unknown declarations exposes Detail but no empty module tabs', async () => {
  const h = exifUiHarness(); h.render();
  const document = { ...exifDocument(''), sections: [], modules: [{ module: 'Unknown 1', status: 'unknown' }] };
  h.loads[0].resolve(document); await tick();
  const tree = h.render();
  assert.deepEqual(nodesOfType(tree, 'Tab').map((node) => node.props.value), ['Detail']);
});

test('switching images releases the old document and late results do not update an unmounted EXIF view', async () => {
  const h = exifUiHarness(); h.render();
  h.loads[0].resolve(exifDocument('first')); await tick();
  assert.equal(shownFields(h.render())[0].value, 'first');
  const next = { ...h.props, tomlPath: 'C:/images/b.toml' };
  assert.deepEqual(shownFields(h.render(next)), []);
  assert.equal(h.loads.length, 2);
  h.runner.dispose();
  h.loads[1].resolve(exifDocument('late')); await tick();
  assert.equal(h.runner.updatesAfterDispose, 0);
});

test('image clicks read prepared TOML without starting a new progress channel or progress bar', async () => {
  const h = exifUiHarness(); h.render();
  assert.equal(h.loads[0].progress, undefined);
  assert.equal(nodesOfType(h.render(), 'MetadataProgress').length, 0);
  h.loads[0].resolve(exifDocument('a')); await tick();
  const next = { ...h.props, tomlPath: 'C:/images/b.toml' }; h.render(next);
  assert.equal(h.loads[1].progress, undefined);
  assert.equal(nodesOfType(h.render(next), 'MetadataProgress').length, 0);
  h.runner.dispose(); h.loads[1].resolve(exifDocument('b')); await tick();
  assert.equal(h.runner.updatesAfterDispose, 0);
});

test('the current-image workspace effect reads only TOML, isolates stale replies and reuses its last selection', async () => {
  const text = readFileSync(new URL('../src/views/mtk/isp6s/Isp6sAeVisual.tsx', import.meta.url), 'utf8');
  const source = ts.createSourceFile('Isp6sAeVisual.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const view = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'Isp6sAeVisual');
  const effect = view.body.statements.find((node) => ts.isExpressionStatement(node) && node.getText(source).startsWith('useEffect(')
    && node.getText(source).includes('const requestId = ++selectedTomlLoadRef.current'));
  assert.ok(effect);
  const runner = hookRunner(), loads = [];
  const { Probe } = loadModule('../src/views/mtk/isp6s/Isp6sAeVisual.tsx', {
    react: runner.hooks, '@/ipc/imageScan': { loadImageToml: (path, progress) => {
      const task = { path, progress, ...deferred() }; loads.push(task); return task.promise;
    } },
  }, {}, `import {useEffect,useState,useRef} from 'react'; import {loadImageToml} from '@/ipc/imageScan';
    export function Probe({currentEntry,imageDir,imageDataRevision,session}) {
      const [selectedTomlData,setSelectedTomlData]=useState({});
      const selectedTomlLoadRef=useRef(0); ${effect.getText(source)}
      return {selectedTomlData};
    }`);
  const props = { currentEntry: entry('a'), imageDir: { dir: 'C:/images', entries: [entry('a'), entry('b')] }, imageDataRevision: 0, session: {} };
  runner.render(Probe, props);
  assert.equal(loads[0].progress, undefined);
  const next = { ...props, currentEntry: entry('b') }; runner.render(Probe, next);
  loads[0].resolve({ stale: 'a' }); await tick();
  assert.deepEqual(runner.render(Probe, next).selectedTomlData, {});
  assert.equal(loads[1].progress, undefined);
  loads[1].resolve({ fresh: 'b' }); await tick();
  assert.equal(runner.render(Probe, next).selectedTomlData.fresh, 'b');
  assert.equal(props.session.selectedToml.data.fresh, 'b');
  runner.dispose();
  // Session survives the view, not a whole-directory data cache.
  assert.equal(props.session.selectedToml.path, entry('b').toml_path);
});

test('the embedded search row precedes module tabs and source diagnostics stay inside Detail', async () => {
  const h = exifUiHarness(); h.render(); h.loads[0].resolve(exifDocument('7')); await tick();
  let tree = h.render();
  const children = tree.props.children.flat(Infinity).filter(Boolean);
  assert.ok(nodesOfType(children[0], 'Input').length, 'search is the first EXIF row');
  assert.ok(nodesOfType(children[1], 'TabList').length, 'module tabs follow search');
  assert.equal(nodesOfType(tree, 'ExifSource').length, 0, 'no provenance strip above normal field rows');
  nodesOfType(tree, 'TabList')[0].props.onTabSelect(null, { value: 'Detail' });
  tree = h.render(); assert.equal(nodesOfType(tree, 'ExifSource').length, 1);
});

test('only readable modules and valid AE statistics receive EXIF tabs', () => {
  const { buildExifTabs } = loadModule('../src/views/mtk/isp6s/TablePane/exifPresentation.ts');
  const document = exifDocument('7');
  document.sections.push({ name: 'Sensor', fields: [] });
  document.modules = ['Sensor', 'MFNR', 'N3D', 'SWNR', 'String'].map((module) =>
    ({ module, parse_status: 'version_only', decoded_fields: 0 }));
  document.ae_tables = [{ name: 'bad', rows: 5, columns: 5, values: [1] }];
  assert.deepEqual(buildExifTabs(document).map((tab) => tab.name), ['AE', 'Detail']);
  document.ae_tables.push({ name: '5x5_LE', rows: 5, columns: 5, values: Array(25).fill(0) });
  assert.deepEqual(buildExifTabs(document).map((tab) => tab.name), ['AE', 'AE_Table', 'Detail']);
});

test('EXIF presentation preserves module nesting, AE summary and all provenance states', () => {
  const { buildExifTabs, exifSourceKey } = loadModule('../src/views/mtk/isp6s/TablePane/exifPresentation.ts');
  const document = exifDocument('12');
  document.sections.push({ name: 'AE_DISPLAY', fields: [{ key: 'iso', value: '50' }] },
    { name: 'ISP.SW', fields: [{ key: 'SW_LCE_LV', value: '100' }] },
    { name: '__luxe_exif', fields: [{ key: 'parser', value: 'debug_parser' }] });
  const tabs = buildExifTabs(document);
  assert.deepEqual(tabs.map((tab) => tab.name), ['AE', 'ISP', 'Detail']);
  assert.equal(tabs[0].fields[1].key, 'AE_DISPLAY.iso');
  assert.equal(tabs[1].fields[0].key, 'ISP.SW.SW_LCE_LV');
  assert.equal(exifSourceKey({ kind: 'jpeg', parser: 'native' }), 'image_exif.source.jpeg');
  assert.equal(exifSourceKey({ kind: 'toml', parser: 'native' }), 'image_exif.source.native_toml');
  assert.equal(exifSourceKey({ kind: 'toml', parser: 'debug_parser' }), 'image_exif.source.debug_parser');
  assert.equal(exifSourceKey({ kind: 'toml', parser: 'unknown' }), 'image_exif.source.unknown_toml');
});

test('DebugParser section aliases fold into module tabs without losing their original section names', () => {
  const { buildExifTabs, matchesExifField } = loadModule('../src/views/mtk/isp6s/TablePane/exifPresentation.ts');
  assert.ok(matchesExifField('ISP_HW_P1.SW_LCE_LV', /^SW_LCE_/));
  assert.ok(matchesExifField('ISP_HW_P1.SW_LCE_LV', /^ISP_HW_P1\./));
  assert.equal(matchesExifField('ISP_HW_P1.SW_LCE_LV', /^AE_TAG_/), false);
  const document = { ...exifDocument(''), sections: ['ISP_HW_P1', 'ISP_HW_P2', 'MF', 'CMN', 'RESVA'].map((name) =>
    ({ name, fields: [{ key: 'value', value: '7' }] })) };
  const tabs = buildExifTabs(document);
  assert.deepEqual(tabs.map((tab) => tab.name), ['ISP', 'MFNR', 'SWNR', 'Common', 'Detail']);
  assert.deepEqual(tabs[0].fields.map((field) => field.key), ['ISP_HW_P1.value', 'ISP_HW_P2.value']);
});

test('AE_Table formats exact rectangular matrices without dropping bins or rendering invalid shapes', () => {
  const { formatExifTable, validExifTable, orderedExifTables } = loadModule('../src/views/mtk/isp6s/TablePane/exifPresentation.ts');
  const unsorted = [{ name: '15x15_LE', rows: 15, columns: 15, values: Array(225).fill(1) },
    { name: '5x5_LE', rows: 5, columns: 5, values: Array(25).fill(1) }];
  assert.deepEqual(orderedExifTables(unsorted).map((table) => table.name), ['5x5_LE', '15x15_LE']);
  assert.equal(unsorted[0].name, '15x15_LE', 'presentation sorting must not mutate the source document');
  for (const [name, rows, columns] of [['5x5_LE', 5, 5], ['15x15_SE', 15, 15], ['Central_Y', 64, 16], ['8_6_LE_Y', 6, 8]]) {
    const table = { name, rows, columns, values: Array.from({ length: rows * columns }, (_, index) => index - 2) };
    assert.ok(validExifTable(table));
    const lines = formatExifTable(table).split('\n');
    assert.equal(lines.length, rows);
    assert.ok(lines.every((line) => line.trim().split(/\s+/).length === columns));
    assert.deepEqual(lines.join(' ').trim().split(/\s+/).map(Number), table.values);
  }
  for (const table of [{ name: 'bad', rows: 5, columns: 5, values: [1] },
    { name: 'bad', rows: 1, columns: 1, values: [NaN] }, { name: 'bad', rows: 999999, columns: 1, values: [] }]) {
    assert.equal(formatExifTable(table), '');
  }
});

test('AE_Table block selector mounts only the selected statistics and supports name filtering', () => {
  const runner = hookRunner();
  const jsx = (type, props) => ({ type, props });
  const { ExifAeTables } = loadModule('../src/views/mtk/isp6s/TablePane/ExifMetadataViews.tsx', {
    react: runner.hooks,
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-i18next': { useTranslation: () => ({ t: (key) => key }) },
    '@fluentui/react-components': { Badge: 'Badge', Label: 'Label', Select: 'Select' },
    './exifPresentation': loadModule('../src/views/mtk/isp6s/TablePane/exifPresentation.ts'),
  });
  const tables = ['5x5_LE', '5x5_SE'].map((name, index) => ({ name, rows: 5, columns: 5, values: Array(25).fill(index + 1) }));
  const props = { tables, pattern: null };
  let tree = runner.render(ExifAeTables, props);
  assert.equal(nodesOfType(tree, 'pre').length, 2);
  nodesOfType(tree, 'Select')[0].props.onChange({ target: { value: '5x5_SE' } });
  tree = runner.render(ExifAeTables, props);
  assert.equal(nodesOfType(tree, 'pre').length, 1);
  assert.equal(nodesOfType(tree, 'h4')[0].props.children, '<<5x5_SE>>');
  tree = runner.render(ExifAeTables, { ...props, pattern: /LE/ });
  assert.equal(nodesOfType(tree, 'pre').length, 0);
  // A replaced dataset cannot be hidden by a now-missing selection.
  tree = runner.render(ExifAeTables, { tables: tables.slice(0, 1), pattern: null });
  assert.equal(nodesOfType(tree, 'pre').length, 1);
  runner.dispose();
});

test('source path is tooltip-only and Detail has six aligned columns without identification source', () => {
  const jsx = (type, props) => ({ type, props });
  const { ExifSource, ExifDetail } = loadModule('../src/views/mtk/isp6s/TablePane/ExifMetadataViews.tsx', {
    react: hookRunner().hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-i18next': { useTranslation: () => ({ t: (key) => key }) },
    '@fluentui/react-components': { Badge: 'Badge', Label: 'Label', Select: 'Select' },
    './exifPresentation': loadModule('../src/views/mtk/isp6s/TablePane/exifPresentation.ts'),
  });
  const document = exifDocument('7');
  const source = ExifSource({ document });
  const badge = nodesOfType(source, 'Badge')[0];
  assert.equal(badge.props.title, document.source.path);
  assert.equal(badge.props.tabIndex, 0);
  assert.equal(nodesOfType(source, 'span').length, 0, 'the path must not consume a visible column');
  const detail = ExifDetail({ modules: [{ module: 'AE', status: 'matched', parse_status: 'decoded', decoded_fields: 2 }] });
  assert.equal(nodesOfType(detail, 'th').length, 6);
  assert.equal(nodesOfType(detail, 'td').length, 6);
  assert.ok(nodesOfType(detail, 'th').every((node) => !node.props.children.includes('identity_source')));
  const rows = nodesOfType(detail, 'tr');
  assert.equal(rows[0].props.style.gridTemplateColumns, rows[1].props.style.gridTemplateColumns);
});

test('Detail has one descriptive source badge, never first/latest history fields', () => {
  const jsx = (type, props) => ({ type, props });
  const { ExifSource } = loadModule('../src/views/mtk/isp6s/TablePane/ExifMetadataViews.tsx', {
    react: hookRunner().hooks, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-i18next': { useTranslation: () => ({ t: (key, data) => data?.source ? `${key}:${data.source}` : key }) },
    '@fluentui/react-components': { Badge: 'Badge' },
    './exifPresentation': loadModule('../src/views/mtk/isp6s/TablePane/exifPresentation.ts'),
  });
  const document = { ...exifDocument('7'), source: { kind: 'toml', parser: 'native', path: 'C:/images/a.toml', content_mode: 'native_merge' },
    preparation: { first_source: 'toml', selected_source: 'jpeg', decision: 'native_replaced' } };
  const tree = ExifSource({ document });
  assert.equal(nodesOfType(tree, 'Badge')[0].props.children, 'image_exif.source.native_merged');
  assert.equal(nodesOfType(tree, 'span').length, 0, 'old preparation history remains compatible but is not displayed');
  const plain = ExifSource({ document: { ...document, source: { ...document.source, content_mode: 'metadata_only' } } });
  assert.equal(nodesOfType(plain, 'Badge')[0].props.children, 'image_exif.source.metadata_only');
});

test('only metadata jobs start a progress channel; normal readers receive a path only', async () => {
  const requests = [];
  const ipc = loadModule('../src/ipc/imageScan.ts', {
    './client': { call: (command, args) => { requests.push({ command, args }); return Promise.resolve({}); } },
    '@tauri-apps/api/core': { Channel: class {}, convertFileSrc: (path) => path },
  });
  const progress = [];
  await ipc.loadImageToml('a.toml');
  await ipc.loadImageExif('a.toml');
  await ipc.prepareImageMetadata('C:/images', (value) => progress.push(value));
  assert.deepEqual(requests.map((request) => request.command), ['load_image_toml', 'load_image_exif', 'prepare_image_metadata']);
  assert.deepEqual(requests[0].args, { path: 'a.toml' }); assert.deepEqual(requests[1].args, { path: 'a.toml' });
  requests[2].args.onProgress.onmessage({ stage: 'JPEG', completed: 1, total: 2 });
  assert.equal(progress.length, 1);
  await ipc.replaceImageMetadata('C:/images', ['C:/images/a.jpg'], (value) => progress.push(value));
  assert.equal(requests[3].command, 'replace_image_metadata');
  requests[3].args.onProgress.onmessage({ stage: 'JPEG', completed: 1, total: 1 });
  assert.equal(progress.length, 2);
  assert.equal(ipc.mergeImageMetadata, undefined, 'forced JPEG replacement must not expose the old merge command');
  assert.equal(ipc.clearImageSidecars, undefined, 'deleted sidecar IPC remains removed');
  assert.equal(ipc.listImageSidecars, undefined, 'deleted sidecar preview remains removed');
});

test('metadata progress uses true counts for preparation/writes and no percentage for external DP', () => {
  const jsx = (type, props) => ({ type, props });
  const { MetadataProgress } = loadModule('../src/views/mtk/isp6s/TablePane/MetadataProgress.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-i18next': { useTranslation: () => ({ t: (key) => key }) },
    '@fluentui/react-components': { ProgressBar: 'ProgressBar' },
    '@fluentui/react-icons': { DocumentData20Regular: 'DocumentData20Regular' },
  });
  const bar = progress => nodesOfType(MetadataProgress({ progress }), 'ProgressBar')[0].props;
  assert.equal(bar(null).value, undefined);
  for (const stage of ['QUEUED', 'DP', 'REFRESH']) {
    const tree = MetadataProgress({ progress: { stage, completed: 8, total: 17 } });
    assert.equal(nodesOfType(tree, 'ProgressBar')[0].props.value, undefined, stage);
    assert.equal(nodesOfType(tree, 'span').at(-1).props.children, 'image_exif.progress_active', 'never show 0/N for the tool wait');
  }
  for (const stage of ['JPEG', 'EXIF', 'PREPARE', 'TOML']) {
    assert.equal(bar({ stage, completed: 8, total: 17 }).value, 8 / 17, stage);
    assert.equal(bar({ stage, completed: 99, total: 17 }).value, 1);
    assert.equal(bar({ stage, completed: -1, total: 17 }).value, 0);
    assert.equal(bar({ stage, completed: 0, total: 0 }).value, undefined);
  }
  const running = MetadataProgress({ progress: { stage: 'DP', completed: 0, total: 0 } });
  assert.equal(running.props.role, 'status');
  assert.equal(running.props['aria-live'], 'polite');
  assert.ok(nodesOfType(running, 'div').some(node => node.props.children === 'image_exif.progress_dp_hint'));
});

test('AE Basic and ToneMap both place EXIF at the left edge without changing tab identities', () => {
  const text = readFileSync(new URL('../src/views/mtk/isp6s/Isp6sAeVisual.tsx', import.meta.url), 'utf8');
  const source = ts.createSourceFile('Isp6sAeVisual.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const values = {};
  for (const name of ['AE_DETAILS_TABS', 'TONE_DETAILS_TABS']) {
    const statement = source.statements.find((node) => ts.isVariableStatement(node) && node.declarationList.declarations.some((decl) => decl.name.getText(source) === name));
    const loaded = loadModule('../src/views/mtk/isp6s/Isp6sAeVisual.tsx', {}, {}, `${statement.getText(source)}; exports.tabs = ${name};`);
    values[name] = loaded.tabs.map((tab) => tab.id);
  }
  assert.deepEqual(values.AE_DETAILS_TABS, ['exif', 'normal', 'face', 'lce', 'bcompare']);
  assert.deepEqual(values.TONE_DETAILS_TABS, ['exif', 'lce', 'tone_cpp']);
});

test('the EXIF button directly replaces JPEG metadata even after global capture prevents the menu', () => {
  const text = readFileSync(new URL('../src/views/mtk/isp6s/TablePane/TablePane.tsx', import.meta.url), 'utf8');
  const source = ts.createSourceFile('TablePane.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let button;
  const visit = node => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'Button'
      && node.getText(source).includes('onReplaceExif')) button = node;
    ts.forEachChild(node, visit);
  };
  visit(source); assert.ok(button);
  const jsx = (type, props) => ({ type, props });
  const component = loadModule('../src/views/mtk/isp6s/TablePane/TablePane.tsx', {
    '@fluentui/react-components': { Button: 'Button' },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@fluentui/react-icons': { DocumentData24Regular: 'DocumentData24Regular' },
  }, {}, `import {Button} from '@fluentui/react-components';
    import {DocumentData24Regular} from '@fluentui/react-icons';
    export function Probe({entries,onReplaceExif,onParseExif,exifParsing=false}) {
      const t = key => key; return (${button.getText(source)});
    }`).Probe;
  let parsed = 0, replaced = 0, stopped = 0;
  const props = { entries: [entry('a'), entry('b')], onReplaceExif: () => replaced++, onParseExif: () => parsed++ };
  const tree = component(props);
  const main = ts.createSourceFile('main.tsx', readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const capture = main.statements.find(node => node.getText(main).startsWith('document.addEventListener("contextmenu"'));
  assert.ok(capture);
  let globalHandler;
  loadModule('../src/main.tsx', {}, { document: { addEventListener: (type, handler, options) => {
    assert.equal(type, 'contextmenu'); assert.equal(options.capture, true); globalHandler = handler;
  } } }, capture.getText(main));
  const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { stopped++; } };
  globalHandler(event); assert.equal(event.defaultPrevented, true);
  tree.props.onClick(); assert.equal(parsed, 1); assert.equal(replaced, 0);
  tree.props.onContextMenu(event); assert.equal(replaced, 1); assert.equal(parsed, 1); assert.equal(stopped, 1);
  assert.equal(tree.props['data-tooltip-wrap'], 'true', 'long action hints must wrap inside the surface');
  assert.equal(tree.props['data-tooltip-position'], 'below-start');
  assert.equal(tree.props['data-tooltip-max-width'], 360);
  assert.equal(tree.props['aria-label'], 'image_exif.action_label');
  assert.doesNotMatch(text, /onMergeExif|<Menu(?:\s|>)/, 'no merge menu or deletion path remains');
  for (const disabled of [{ ...props, exifParsing: true }, { ...props, entries: [] }]) {
    const blocked = component(disabled); assert.equal(blocked.props.disabled, true);
    blocked.props.onContextMenu(event); assert.equal(replaced, 1);
  }
});

test('the workspace right-click handler immediately replaces the whole directory and uses local card progress', async () => {
  const text = readFileSync(new URL('../src/views/mtk/isp6s/Isp6sAeVisual.tsx', import.meta.url), 'utf8');
  const source = ts.createSourceFile('Isp6sAeVisual.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration, table;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleReplaceExif') declaration = node;
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'TablePane') table = node;
    ts.forEachChild(node, visit);
  };
  visit(source); assert.ok(declaration); assert.ok(table);
  assert.ok(table.attributes.properties.some(node => ts.isJsxAttribute(node) && node.name.text === 'metadataProgress'));
  assert.doesNotMatch(text, /<MetadataProgress[\s>]|^\s*\{metadataProgress\}\s*$/m, 'workspace roots must not render a full-width strip');
  const paneText = readFileSync(new URL('../src/views/mtk/isp6s/TablePane/TablePane.tsx', import.meta.url), 'utf8');
  assert.match(paneText, /exifParsing && <MetadataProgress progress=\{metadataProgress\}/, 'progress belongs inside the shared image card');
  const progress = [], notices = [], calls = [], busy = [];
  const pending = deferred(); const imageDir = { dir: 'C:/images', entries: [entry('a'), entry('b')] };
  const controllerRef = { current: null }, parsingRef = { current: false };
  const probe = loadModule('../src/views/mtk/isp6s/Isp6sAeVisual.tsx', {}, {
    imageDir, isp: 'ISP6S', imageTabIdx: 0, workspaceKey: 'ISP6S|1',
    exifRequestRef: { current: 0 }, exifParsingRef: parsingRef, exifProgressControllerRef: controllerRef,
    useMtkStore: { getState: () => ({ imageDir: { 'ISP6S|0': imageDir } }) },
    setExifParsing: value => busy.push(value), setExifProgress: value => progress.push(value),
    onNotice: value => notices.push(value), t: key => key, ImageExifTaskError: class extends Error {},
    replaceWorkspaceImageMetadata: (...args) => { calls.push(args); return pending.promise; },
  }, `const ${declaration.getText(source)}; exports.run = handleReplaceExif;`);
  const running = probe.run(); assert.equal(calls.length, 1, 'no menu or DP confirmation is involved');
  assert.deepEqual(calls[0].slice(0, 3), ['ISP6S', 0, []]);
  assert.equal(progress[0].stage, 'QUEUED');
  pending.resolve({ summary: { ...preparedSummary, partial: 0 } }); await running;
  assert.deepEqual(busy, [true, false]); assert.equal(parsingRef.current, false);
  assert.equal(progress.at(-1), null); assert.equal(calls[0][5].aborted, true);
  assert.equal(notices[0].title, 'image_exif.native.completed');
});

test('directory A -> B -> A invalidates view progress and confirmation without cancelling the shared job', () => {
  const text = readFileSync(new URL('../src/views/mtk/isp6s/Isp6sAeVisual.tsx', import.meta.url), 'utf8');
  const source = ts.createSourceFile('Isp6sAeVisual.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect'
      && node.arguments[1]?.getText(source) === '[imageDir.dir]'
      && node.arguments[0].getText(source).includes('exifDirectoryRef')) effect = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(source); assert.ok(effect);
  const imageDir = { dir: 'C:/images' }, directory = { current: imageDir.dir }, request = { current: 3 };
  const controller = new AbortController(), controllerRef = { current: controller }, parsing = { current: true };
  const cleared = [];
  const { run } = loadModule('../src/views/mtk/isp6s/Isp6sAeVisual.tsx', {}, {
    imageDir, exifDirectoryRef: directory, exifRequestRef: request, exifProgressControllerRef: controllerRef, exifParsingRef: parsing,
    setExifParsing: value => cleared.push(['busy', value]), setExifProgress: value => cleared.push(['progress', value]),
    setDpOverwrite: value => cleared.push(['confirmation', value]),
  }, `exports.run = ${effect.getText(source)};`);
  run(); assert.equal(controller.signal.aborted, false); assert.equal(cleared.length, 0);
  imageDir.dir = 'D:/replacement'; run();
  assert.equal(controller.signal.aborted, true); assert.equal(request.current, 4);
  assert.equal(parsing.current, false); assert.equal(controllerRef.current, null);
  assert.deepEqual(cleared, [['busy', false], ['progress', null], ['confirmation', null]]);
  imageDir.dir = 'C:/images'; run(); assert.equal(request.current, 5);
  assert.equal(directory.current, imageDir.dir);
});

test('authoritative DP replacement has an explicit directory-scoped confirmation without any deletion action', () => {
  const jsx = (type, props) => ({ type, props });
  const components = ['Button', 'Dialog', 'DialogActions', 'DialogBody', 'DialogContent', 'DialogSurface', 'DialogTitle'];
  const { ImageExifOverwriteDialog } = loadModule('../src/views/mtk/isp6s/TablePane/ImageExifOverwriteDialog.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx }, '@fluentui/react-components': Object.fromEntries(components.map((name) => [name, name])),
    'react-i18next': { useTranslation: () => ({ t: (key) => key }) },
  });
  let run = 0, cancelled = 0;
  const props = { imageDir: 'C:/images', imageCount: 2, onCancel: () => cancelled++, onConfirm: () => run++ };
  const tree = ImageExifOverwriteDialog(props);
  assert.equal(run, 0);
  assert.ok(nodesOfType(tree, 'p').some((node) => node.props.children === props.imageDir));
  tree.props.onOpenChange(null, { open: false }); assert.equal(cancelled, 1); assert.equal(run, 0);
  nodesOfType(tree, 'Button')[1].props.onClick(); assert.equal(run, 1);
  assert.equal(nodesOfType(ImageExifOverwriteDialog({ ...props, imageCount: 0 }), 'Button')[1].props.disabled, true);
});

function fieldIpcHarness() {
  const loads = [];
  const ipc = loadModule('../src/ipc/imageScan.ts', {
    './client': { call: (command, args) => {
      assert.equal(command, 'load_image_toml_fields_batch');
      const task = { args, ...deferred() };
      loads.push(task);
      return task.promise;
    } },
    '@tauri-apps/api/core': { convertFileSrc: (path) => path, Channel: class {} },
  });
  return { loads, ...ipc };
}

test('shared field IPC deduplicates only within the same dataset and metadata revision', async () => {
  const h = fieldIpcHarness();
  const entries = [entry('a')], paths = entries.map((row) => row.toml_path), keys = ['AE_TAG_CWV'];
  const before = h.loadImageTomlFieldsBatchShared(paths, keys, { entries, revision: 0 });
  assert.equal(h.loadImageTomlFieldsBatchShared(paths, keys, { entries, revision: 0 }), before);
  const after = h.loadImageTomlFieldsBatchShared(paths, keys, { entries, revision: 1 });
  assert.notEqual(after, before);
  const rescanned = h.loadImageTomlFieldsBatchShared(paths, keys, { entries: entries.slice(), revision: 1 });
  assert.notEqual(rescanned, after);
  assert.equal(h.loads.length, 3);
  assert.deepEqual(h.loads[1].args, { paths, keys }, 'scope stays in the JS wrapper, not the Rust IPC');
  h.loads.forEach((task, index) => task.resolve({ [paths[0]]: { AE_TAG_CWV: String(index) } }));
  await Promise.all([before, after, rescanned]);
});

test('settling an obsolete field IPC cannot evict a newer in-flight request', async () => {
  const h = fieldIpcHarness();
  const entries = [entry('a')], paths = [entries[0].toml_path], keys = ['AE_TAG_CWV'];
  const old = h.loadImageTomlFieldsBatchShared(paths, keys, { entries, revision: 0 });
  const fresh = h.loadImageTomlFieldsBatchShared(paths, keys, { entries, revision: 1 });
  h.loads[0].resolve({});
  await old;
  assert.equal(h.loadImageTomlFieldsBatchShared(paths, keys, { entries, revision: 1 }), fresh);
  assert.equal(h.loads.length, 2);
  h.loads[1].reject(new Error('read failed'));
  await assert.rejects(fresh, /read failed/);
  const retry = h.loadImageTomlFieldsBatchShared(paths, keys, { entries, revision: 1 });
  assert.equal(h.loads.length, 3);
  h.loads[2].resolve({});
  await retry;
});

// Execute the actual ImageTab field-cache and window/prefetch effects, without
// rendering unrelated charts or duplicating their request-generation logic.
function tableFieldProbe(hooks, loadFields, timers) {
  const relative = '../src/views/mtk/isp6s/TablePane/TablePane.tsx';
  const text = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const source = ts.createSourceFile('TablePane.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set([
    'IMAGE_TABLE_FIELD_CACHE_LIMIT', 'IMAGE_TABLE_GLOBAL_CACHE_LIMIT', 'IMAGE_TABLE_LOAD_DEBOUNCE_MS',
    'IMAGE_TABLE_PREFETCH_DELAY_MS', 'globalImageTableFieldCache', 'globalImageTableCacheKey',
    'readGlobalImageTableFields', 'rememberGlobalImageTableFields', 'tableWindowPathsRef',
    'tableFieldCacheRef', 'tableFieldAccessOrderRef', 'tableTomlPathSetRef', 'loadingTableFieldPathsRef',
    'tableFieldKeySignatureRef', 'tableFieldGenerationRef', 'imageTomlKeySignature', 'imageMetadataContext',
    '[tomls, setTomls]', 'tableWindowSignature', 'tablePrefetchSignature',
    'rememberTableFieldRows', 'readCachedTableRows', 'pendingTableFieldPaths',
  ]);
  const selected = (node) => ts.isFunctionDeclaration(node) ? names.has(node.name?.text)
    : ts.isVariableStatement(node) && node.declarationList.declarations.some((decl) => names.has(decl.name.getText(source)));
  const imageTab = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'ImageTab');
  assert.ok(imageTab?.body);
  const effects = [];
  const statements = imageTab.body.statements.filter((node) => {
    if (selected(node)) return true;
    if (!ts.isExpressionStatement(node) || !ts.isCallExpression(node.expression)
      || !['useEffect', 'useLayoutEffect'].includes(node.expression.expression.getText(source))) return false;
    const code = node.getText(source);
    const include = ['tableWindowPathsRef.current = tableWindowPaths', 'tableFieldGenerationRef.current += 1',
      'tableFieldKeySignatureRef.current = imageTomlKeySignature',
      'pendingTableFieldPaths(tableWindowPaths)', 'pendingTableFieldPaths(tablePrefetchPaths)']
      .some((part) => code.includes(part));
    if (include) effects.push(node);
    return include;
  });
  assert.equal(effects.length, 5, 'keep the probe attached to generation, cache and field-loading effects');
  const code = `import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
    import { loadImageTomlFieldsBatchShared } from '@/ipc/imageScan';
    ${source.statements.filter(selected).map((node) => node.getText(source)).join('\n')}
    export function FieldProbe({entries, imageDataRevision = 0, imageTomlKeys, tableWindowPaths, tablePrefetchPaths,
      tableReloadVersion = 0}) {
      ${statements.map((node) => node.getText(source)).join('\n')}
      return {tomls, loading: loadingTableFieldPathsRef.current, cache: tableFieldCacheRef.current};
    }`;
  return loadModule(relative, { react: hooks, '@/ipc/imageScan': { loadImageTomlFieldsBatchShared: loadFields } },
    { window: timers }, code).FieldProbe;
}

function fieldTableHarness() {
  const runner = hookRunner(), loads = [], scheduled = new Map();
  let nextTimer = 0;
  const timers = {
    setTimeout: (callback) => { scheduled.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: (id) => scheduled.delete(id),
  };
  const component = tableFieldProbe(runner.hooks, (paths, keys, context) => {
    const task = { paths, keys, context, ...deferred() };
    loads.push(task);
    return task.promise;
  }, timers);
  const props = { entries: [entry('a')], imageDataRevision: 0,
    imageTomlKeys: ['AE_TAG_CWV'], tableWindowPaths: [entry('a').toml_path], tablePrefetchPaths: [] };
  return { runner, loads, props, render: (next = props) => runner.render(component, next),
    flush() { const callbacks = [...scheduled.values()]; scheduled.clear(); callbacks.forEach((callback) => callback()); } };
}

for (const prefetch of [false, true]) for (const changed of ['revision', 'entries']) {
  test(`${prefetch ? 'prefetch' : 'visible'} field replies cannot cross ${changed} changes or clear newer loading flags`, async () => {
    const h = fieldTableHarness();
    if (prefetch) {
      h.props.tablePrefetchPaths = h.props.tableWindowPaths;
      h.props.tableWindowPaths = [];
    }
    h.render(); h.flush();
    assert.equal(h.loads.length, 1);
    // The paths and keys stay identical across a revision bump or a rescan.
    const refreshed = { ...h.props, ...(changed === 'revision'
      ? { imageDataRevision: 1 } : { entries: h.props.entries.slice() }) };
    h.render(refreshed); h.flush();
    assert.equal(h.loads.length, 2);
    const path = entry('a').toml_path;
    h.loads[0].resolve({ [path]: { AE_TAG_CWV: 'stale JPEG' } });
    await tick();
    const waiting = h.render(refreshed);
    assert.equal(waiting.cache[path], undefined);
    assert.equal(waiting.loading.has(path), true);
    h.loads[1].resolve({ [path]: { AE_TAG_CWV: 'fresh TOML' } });
    await tick();
    assert.equal(h.render(refreshed).cache[path].AE_TAG_CWV, 'fresh TOML');
    h.runner.dispose();
  });
}

test('late field failures and replies after unmount do not change current state', async () => {
  const h = fieldTableHarness();
  h.render(); h.flush();
  const refreshed = { ...h.props, entries: h.props.entries.slice(), imageDataRevision: 1 };
  h.render(refreshed); h.flush();
  const path = entry('a').toml_path;
  h.loads[1].resolve({ [path]: { AE_TAG_CWV: 'fresh' } });
  await tick();
  h.loads[0].reject(new Error('old JPEG read failed'));
  await tick();
  assert.equal(h.render(refreshed).tomls[path].AE_TAG_CWV, 'fresh');
  const last = { ...refreshed, imageDataRevision: 2 };
  h.render(last); h.flush();
  h.runner.dispose();
  h.loads[2].resolve({ [path]: { AE_TAG_CWV: 'unmounted' } });
  await tick();
  assert.equal(h.runner.updatesAfterDispose, 0);
});

for (const tone of [false, true]) {
  test(`${tone ? 'ToneMap' : 'AE'} heatmap fields reload on metadata revision and ignore old source replies`, async () => {
    const relative = `../src/views/mtk/isp6s/ImagePane/${tone ? 'ToneChartMapMode' : 'ChartMapMode'}.tsx`;
    const text = readFileSync(new URL(relative, import.meta.url), 'utf8');
    const source = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const component = source.statements.find((node) => ts.isFunctionDeclaration(node)
      && node.name?.text === (tone ? 'ToneChartMapMode' : 'ChartMapMode'));
    const names = new Set(tone ? ['[heatmapData, setHeatmapData]', 'currentHeatmap']
      : ['[heatmapRows, setHeatmapRows]', 'currentHeatmapRows']);
    const body = component.body.statements.filter((node) =>
      (ts.isVariableStatement(node) && node.declarationList.declarations.some((decl) => names.has(decl.name.getText(source))))
      || (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
        && node.expression.expression.getText(source) === 'useEffect'
        && node.getText(source).includes('loadImageTomlFieldsBatchShared(')));
    assert.equal(body.length, 3, 'execute the actual heatmap state, loading effect and revision guard');
    const code = `import { useState, useEffect } from 'react';
      import { loadImageTomlFieldsBatchShared } from '@/ipc/imageScan';
      const TONE_HEATMAP_KEYS = ['SW_LCE_LV'];
      export function Probe({entries, imageDataRevision}) {
        const heatmapRequested = true, heatmapRetry = 0, heatmapBvKey = 'AE_TAG_REALBVX1000';
        const requestedHeatmapFields = TONE_HEATMAP_KEYS, requestedHeatmapFieldsKey = 'SW_LCE_LV';
        const imagePosition = (data) => data;
        ${body.map((node) => node.getText(source)).join('\n')}
        return ${tone ? 'currentHeatmap' : 'currentHeatmapRows'};
      }`;
    const runner = hookRunner(), h = fieldIpcHarness();
    const { Probe } = loadModule(relative, { react: runner.hooks, '@/ipc/imageScan': h }, {}, code);
    const props = { entries: [entry('a')], imageDataRevision: 0 };
    runner.render(Probe, props);
    const next = { ...props, imageDataRevision: 1 };
    assert.equal(runner.render(Probe, next), null);
    assert.equal(h.loads.length, 2);
    const path = props.entries[0].toml_path;
    h.loads[1].resolve({ [path]: { SW_LCE_LV: 'fresh' } });
    await tick();
    const fresh = runner.render(Probe, next);
    assert.equal(fresh.revision, 1);
    h.loads[0].resolve({ [path]: { SW_LCE_LV: 'stale' } });
    await tick();
    assert.equal(runner.render(Probe, next), fresh);
    runner.dispose();
  });
}
