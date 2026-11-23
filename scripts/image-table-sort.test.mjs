import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/views/mtk/isp6s/TablePane/imageTableSort.ts', import.meta.url), 'utf8');
const module = { exports: {} };
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
new Function('exports', code)(module.exports);
const { parseImageSortNumber, sortImageRows, createImageTableSortLoader, IMAGE_SORT_BATCH_SIZE } = module.exports;
const entries = count => Array.from({ length: count }, (_, i) => ({ name: `${i}.jpg`, jpg_path: `D:/images/${i}.jpg`, toml_path: `D:/images/${i}.toml` }));
const tick = () => new Promise(resolve => setImmediate(resolve));

test('sort preserves compound numeric parsing, missing-last and original-index tie ordering', () => {
  const inputs = ['10 [1, 2]', '2', '-', '1,024', '-3.5', '2', '', undefined, '1.5e2', 'gain=4.2', 'NaN', 'Infinity', '0', '1_000'];
  const values = Float64Array.from(inputs, text => parseImageSortNumber(text) ?? NaN);
  const rows = inputs.map((_, i) => ({ i }));
  assert.deepEqual(sortImageRows(rows.slice(), values, 'asc').map(row => row.i), [4, 12, 1, 5, 9, 0, 8, 13, 3, 2, 6, 7, 10, 11]);
  assert.deepEqual(sortImageRows(rows.slice(), values, 'desc').map(row => row.i), [3, 13, 8, 0, 9, 1, 5, 12, 4, 2, 6, 7, 10, 11]);
  assert.deepEqual(rows.map(row => row.i), inputs.map((_, i) => i));
  assert.deepEqual(sortImageRows([rows[5], rows[1], rows[3]], values, 'asc').map(row => row.i), [1, 5, 3], 'filtered rows use source indexes');
});

test('field loader batches reads and retains one numeric scalar per source entry', async () => {
  const count = IMAGE_SORT_BATCH_SIZE * 2 + 188;
  const context = { entries: entries(count), revision: 3 };
  const calls = [];
  const loader = createImageTableSortLoader(async (paths, keys, identity) => {
    calls.push(paths.length); assert.deepEqual(keys, ['A', 'B']); assert.equal(identity, context);
    return Object.fromEntries(paths.map(path => [path, { A: '2', B: '3' }]));
  });
  const snapshot = await loader.load(context, '=A+B', ['A', 'B'], row => String(Number(row.A) + Number(row.B)));
  assert.deepEqual(calls, [IMAGE_SORT_BATCH_SIZE, IMAGE_SORT_BATCH_SIZE, 188]);
  assert.equal(snapshot.key, '=A+B'); assert.equal(snapshot.entries, context.entries); assert.equal(snapshot.revision, 3);
  assert.equal(snapshot.values.byteLength, count * 8);
  assert.ok(snapshot.values.every(value => value === 5));
  sortImageRows(context.entries.map((e, i) => ({ e, i })), snapshot.values, 'desc');
  assert.equal(calls.length, 3, 'direction-only sorting reuses scalars without IPC');
});

test('rapid column changes keep only one active batch and the latest pending column', async () => {
  const context = { entries: entries(IMAGE_SORT_BATCH_SIZE * 4), revision: 1 };
  const gates = [], calls = [];
  let active = 0, peak = 0;
  const loader = createImageTableSortLoader((paths, keys) => {
    calls.push(keys[0]); peak = Math.max(peak, ++active);
    return new Promise(resolve => gates.push(() => { active--; resolve(Object.fromEntries(paths.map(path => [path, { value: '1' }]))); }));
  });
  const a = loader.load(context, 'A', ['A'], row => row.value);
  const pending = Array.from({ length: 100 }, (_, i) => loader.load(context, `B${i}`, [`B${i}`], row => row.value));
  assert.equal(calls.length, 1); assert.equal(peak, 1);
  assert.ok((await Promise.all(pending.slice(0, -1))).every(value => value === null), 'superseded queued jobs settle immediately');
  gates.shift()(); await tick();
  assert.equal(await a, null);
  assert.deepEqual(calls, ['A', 'B99']);
  loader.cancel(); gates.shift()();
  assert.equal(await pending.at(-1), null);
  assert.equal(peak, 1); assert.equal(active, 0);
});

test('unmount/metadata refresh cancels future batches and errors remain recoverable', async () => {
  const context = { entries: entries(IMAGE_SORT_BATCH_SIZE * 4), revision: 1 };
  let release, calls = 0;
  const loader = createImageTableSortLoader(paths => {
    calls++;
    return new Promise(resolve => { release = () => resolve(Object.fromEntries(paths.map(path => [path, { A: '7' }]))); });
  });
  const old = loader.load(context, 'A', ['A'], row => row.A);
  loader.cancel(); release(); assert.equal(await old, null); assert.equal(calls, 1);
  let fail = true;
  const recover = createImageTableSortLoader(async paths => {
    if (fail) throw new Error('read failed');
    return Object.fromEntries(paths.map(path => [path, {}]));
  });
  await assert.rejects(recover.load(context, 'A', ['A'], row => row.A), /read failed/);
  fail = false;
  const next = await recover.load({ ...context, revision: 2 }, 'B', ['B'], row => row.B);
  assert.equal(next.revision, 2); assert.ok(next.values.every(Number.isNaN));
});
