import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/views/mtk/isp6s/TablePane/imageTableMapping.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { imageTableExtraColumns, isImageTableColumnMapped } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('scene and portrait keep independent fields and merge shared keys once', () => {
  const schema = { Image: {}, image_table: { scene: { BV: 'bv', B2D: 'b2d' }, portrait: { Brightness: 'bv', FDY: 'fdy' } } };
  assert.deepEqual(imageTableExtraColumns(schema, 'scene'), [['BV', 'bv'], ['B2D', 'b2d']]);
  assert.deepEqual(imageTableExtraColumns(schema, 'portrait'), [['Brightness', 'bv'], ['FDY', 'fdy']]);
  assert.deepEqual(imageTableExtraColumns(schema), [['Brightness', 'bv'], ['FDY', 'fdy'], ['B2D', 'b2d']]);
  assert.equal(isImageTableColumnMapped(schema, 'fdy', 'scene'), false);
  assert.equal(isImageTableColumnMapped(schema, 'fdy', 'portrait'), true);
});

test('legacy mappings are retained while explicit empty groups hide extras', () => {
  const legacy = { Image: { B2D: 'b2d' } };
  assert.deepEqual(imageTableExtraColumns(legacy, 'scene'), [['B2D', 'b2d']]);
  assert.deepEqual(imageTableExtraColumns({ ...legacy, image_table: { scene: {} } }, 'scene'), []);
  assert.deepEqual(imageTableExtraColumns({ ...legacy, image_table: { scene: null } }, 'scene'), [['B2D', 'b2d']]);
});
