import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const chartPath = '../src/views/mtk/isp6s/ImagePane/ChartMapMode.tsx';
const tablePath = '../src/views/mtk/isp6s/TablePane/FaceTable.tsx';

// Execute the real calculation functions and their declaration dependencies,
// without mounting unrelated charts or importing the Tauri window runtime.
function loadSelected(relative, names, globals = {}) {
  const url = new URL(relative, import.meta.url);
  const source = ts.createSourceFile(relative, readFileSync(url, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = new Map();
  for (const statement of source.statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
      declarations.set(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) declarations.set(declaration.name.text, statement);
      }
    }
  }
  const selected = new Set();
  const include = name => {
    const statement = declarations.get(name);
    if (!statement || selected.has(statement) || Object.hasOwn(globals, name)) return;
    selected.add(statement);
    const visit = node => {
      if (ts.isIdentifier(node)) include(node.text);
      ts.forEachChild(node, visit);
    };
    visit(statement);
  };
  names.forEach(name => { assert.ok(declarations.has(name), name); include(name); });
  const code = source.statements.filter(statement => selected.has(statement)).map(statement => statement.getText(source)).join('\n')
    + `\nmodule.exports = { ${names.join(', ')} };`;
  const { outputText } = ts.transpileModule(code, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), outputText)(
    createRequire(url), module, module.exports, ...Object.values(globals),
  );
  return module.exports;
}

// Execute the real count-cell events without mounting canvas/scatter observers.
function heatmapCellEvents(functionName, globals, relative = chartPath) {
  const parsed = ts.createSourceFile(relative, readFileSync(new URL(relative, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === functionName);
  assert.ok(declaration, functionName);
  let attributes;
  const visit = node => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const props = node.attributes.properties.filter(ts.isJsxAttribute);
      const click = props.find(prop => prop.name.getText(parsed) === 'onClick');
      if (click && /onSelectHeatmapImages|onHitImages/.test(click.getText(parsed))
        && props.some(prop => prop.name.getText(parsed) === 'onContextMenu')) attributes = props;
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration);
  assert.ok(attributes, `${functionName}: count-cell left click`);
  const events = ['onClick', 'onContextMenu'].map(name => {
    const prop = attributes.find(prop => prop.name.getText(parsed) === name);
    return `${name}: ${prop.initializer.expression.getText(parsed)}`;
  });
  const { outputText } = ts.transpileModule(`module.exports = { ${events.join(', ')} };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  new Function('module', ...Object.keys(globals), outputText)(module, ...Object.values(globals));
  return module.exports;
}

test('count-mode heatmap cells select hits on left click and reserve right click for parameter navigation', () => {
  const tableSource = { rowHeaders: [0, 10], columnHeaders: [0, 10] };
  const points = [{ path: 'a.toml', bv: 0, dr: 0, axis: 0 }, { path: 'b.toml', bv: 5, dr: 5, axis: 5 },
    { path: 'a.toml', bv: 0, dr: 0, axis: 0 }, { path: 'other.toml', bv: 10, dr: 10, axis: 10 }];
  const helpers = loadSelected(chartPath, ['faceBvDrHitPaths', 'hsAreaHitPaths']);
  for (const name of ['FaceProbEditableCell', 'FaceBvDrTableCard', 'HsAreaGrid', 'ThresholdEditableCell', 'ToneNumberCell']) {
    for (const blocked of ['', 'loading', 'failed']) {
      const selected = [], jumps = [];
      const globals = {
        ...helpers, source: tableSource, eligibleHeatmapPoints: points, heatmapPoints: points,
        rowIndex: 0, columnIndex: 0, field: { value: '123' }, value: '123', target: { kind: 'value', rowIndex: 0, columnIndex: 0 },
        showHitCounts: true, heatmapLoading: blocked === 'loading', heatmapFailed: blocked === 'failed',
        onSelectHeatmapImages: paths => selected.push(paths ?? ['a.toml', 'b.toml']),
        onSourceJump: (...args) => jumps.push(args), jumpToCellSource: (...args) => jumps.push(args), onCellSourceJump: (...args) => jumps.push(args),
        onHitImages: () => selected.push(['a.toml', 'b.toml']), tableId: 'target',
        controls: { heatmapLoading: blocked === 'loading', heatmapFailed: blocked === 'failed', onCellJump: (...args) => jumps.push(args) },
      };
      const relative = name === 'ToneNumberCell' ? '../src/views/mtk/isp6s/ImagePane/ToneChartMapMode.tsx' : chartPath;
      const events = heatmapCellEvents(name, globals, relative);
      let stopped = 0, prevented = 0;
      const event = { stopPropagation: () => stopped++, preventDefault: () => prevented++ };
      events.onClick(event);
      assert.deepEqual(selected, blocked ? [] : [['a.toml', 'b.toml']], `${name}/${blocked}: all unique hits`);
      assert.equal(jumps.length, 0, 'left click never jumps');
      events.onContextMenu(event);
      assert.equal(jumps.length, 1, `${name}: right click still navigates`);
      assert.equal(selected.length, blocked ? 0 : 1, 'right click cannot also change image selection');
      assert.equal(stopped, 2);
      assert.equal(prevented, 1);
    }
  }
});

test('threshold parameter mode and an unbound count cell cannot accidentally select images', () => {
  let selections = 0;
  const props = { showHitCounts: false, heatmapLoading: false, heatmapFailed: false, value: '123',
    onSelectHeatmapImages: () => selections++, onSourceJump: undefined };
  const events = heatmapCellEvents('ThresholdEditableCell', props);
  const event = { stopPropagation() {}, preventDefault() {} };
  events.onClick(event);
  events.onContextMenu(event);
  assert.equal(selections, 0);
  const unbound = heatmapCellEvents('FaceProbEditableCell', { ...props, onSelectHeatmapImages: undefined });
  assert.doesNotThrow(() => unbound.onClick(event));
  assert.doesNotThrow(() => unbound.onContextMenu(event));
});

test('left-click heatmap hits reach the workspace multi-selection and focus only the first matching image', () => {
  const relative = '../src/views/mtk/isp6s/Isp6sAeVisual.tsx';
  const parsed = ts.createSourceFile(relative, readFileSync(new URL(relative, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'onSelectHeatmapImages') declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(declaration);
  const { outputText } = ts.transpileModule(`const ${declaration.getText(parsed)}; module.exports = onSelectHeatmapImages;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const entries = ['a.toml', 'b.toml', 'other.toml'].map(toml_path => ({ toml_path }));
  const states = [], picks = [];
  const globals = { heatmapSelection: { entries, paths: ['other.toml'] }, imageDir: { entries },
    setHeatmapSelection: state => states.push(state), onPickImage: (...args) => picks.push(args) };
  const module = { exports: {} };
  new Function('module', ...Object.keys(globals), outputText)(module, ...Object.values(globals));
  const cell = heatmapCellEvents('FaceBvDrTableCard', {
    ...loadSelected(chartPath, ['faceBvDrHitPaths']), source: { rowHeaders: [0, 10], columnHeaders: [0, 10] },
    eligibleHeatmapPoints: [{ path: 'a.toml', bv: 0, dr: 0 }, { path: 'b.toml', bv: 5, dr: 5 }, { path: 'other.toml', bv: 10, dr: 10 }],
    rowIndex: 0, columnIndex: 0, heatmapLoading: false, heatmapFailed: false, onSelectHeatmapImages: module.exports,
  });
  cell.onClick({ stopPropagation() {} });
  assert.deepEqual(states[0], { entries, paths: ['a.toml', 'b.toml'] });
  assert.deepEqual(picks, [[0, { preserveHeatmapSelection: true }]]);
  module.exports([]);
  assert.deepEqual(states[1].paths, [], 'zero hits clears selection without picking an unrelated image');
  assert.equal(picks.length, 1);
});

const presentation = loadSelected('../src/views/mtk/isp6s/TablePane/tableCellPresentation.ts', ['formatSubstitutedValue']);
const table = loadSelected(tablePath, ['evaluateFaceTable', 'withLookupAliases'], presentation);

// This resource has only quoted scalar strings and [FBT]/[FLT] sections. Read
// those actual expressions rather than keeping a second formula in this test.
function faceSchema() {
  const schema = { top_kv: {}, FBT: {}, FLT: {} };
  let section = schema.top_kv;
  for (const raw of readFileSync(new URL('../src-tauri/resources/face_table.toml', import.meta.url), 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const header = line.match(/^\[(FBT|FLT)\]$/);
    if (header) { section = schema[header[1]]; continue; }
    const field = line.match(/^("(?:[^"\\]|\\.)*"|\w+)\s*=\s*("(?:[^"\\]|\\.)*")\s*$/);
    assert.ok(field, `unexpected resource syntax: ${line}`);
    section[field[1].startsWith('"') ? JSON.parse(field[1]) : field[1]] = JSON.parse(field[2]);
  }
  return schema;
}
const schema = faceSchema();
const qualified = (scope, name) => `${scope}\0${name}`;
function detailData(overrides = {}) {
  return {
    AE_TAG_AE_TARGET: '1024', AE_TAG_FACE_LOW_BOUND: '200', AE_TAG_FACE_HIGH_BOUND: '600',
    [schema.FLT.CWV]: '400', AE_TAG_FLT_FDY: '1024', AE_TAG_FBT_FDY: '1024',
    AE_TAG_FLT_FDTH: '1024', AE_TAG_FLT_OETH: '1024', AE_TAG_FLT_OE_SYS: '1024', AE_TAG_FLT_FDMINTH: '0',
    AE_TAG_FBT_FDTH: '1024', AE_TAG_FBT_OETH: '1024', AE_TAG_FBT_OE_SYS: '1024', AE_TAG_FBT_FDMINTH: '0',
    AE_TAG_FBT_FDDR_RA: '1024', AE_TAG_FLT_FDSZ_RA: '1024', AE_TAG_FACE_PROB: '512',
    [schema.FLT.NormalTarget]: '100', ...overrides,
  };
}
function detail(overrides) {
  return table.evaluateFaceTable(schema, table.withLookupAliases(detailData(overrides)));
}

for (const [raw, expected] of [[100, 200], [400, 400], [900, 600], [200, 200], [600, 600]]) {
  test(`Face detail clamps ${raw} to ${expected} using the displayed CWR range`, () => {
    const result = detail({ [schema.FLT.CWV]: String(raw) });
    assert.equal(result.display.get(qualified('FLT', 'Link_FACE_CWR')), expected.toFixed(1));
    assert.equal(result.display.get(qualified('TOP', 'Cal_FLT')), expected.toFixed(1));
    assert.match(result.substitutions.get(qualified('FLT', 'Link_FACE_CWR')), /limit\(.*200\.00.*600\.00\)/);
  });
}

test('Face detail clamps after mixing and propagates the limited result into Cal_Gain', () => {
  const result = detail({ [schema.FLT.CWV]: '1000', AE_TAG_FLT_FDSZ_RA: '512' });
  assert.equal(result.display.get(qualified('FLT', 'Link_FACE_CWR')), '550.0', 'do not clamp FLT target before weighting');
  assert.equal(result.display.get(qualified('FBT', 'BackTarget')), '550.0', 'FBT remains unbounded');
  const capped = detail({ [schema.FLT.CWV]: '2000' });
  assert.equal(capped.display.get(qualified('TOP', 'Cal_Gain')), (600 / 1050).toFixed(2));
});

test('Face detail keeps full boundary precision and handles equal/reversed/zero bounds', () => {
  const precise = detail({ AE_TAG_AE_TARGET: '752', AE_TAG_FACE_LOW_BOUND: '90', AE_TAG_FACE_HIGH_BOUND: '91', [schema.FLT.CWV]: '1000' });
  assert.equal(precise.display.get(qualified('FLT', 'Link_FACE_CWR')), (752 * 91 / 1024).toFixed(1));
  assert.equal(detail({ AE_TAG_FACE_LOW_BOUND: '600', AE_TAG_FACE_HIGH_BOUND: '200', [schema.FLT.CWV]: '900' }).display.get(qualified('FLT', 'Link_FACE_CWR')), '600.0');
  assert.equal(detail({ AE_TAG_FACE_LOW_BOUND: '300', AE_TAG_FACE_HIGH_BOUND: '300' }).display.get(qualified('FLT', 'Link_FACE_CWR')), '300.0');
  assert.equal(detail({ AE_TAG_FACE_LOW_BOUND: '0', AE_TAG_FACE_HIGH_BOUND: '0' }).display.get(qualified('FLT', 'Link_FACE_CWR')), '0.0');
});

for (const key of ['AE_TAG_AE_TARGET', 'AE_TAG_FACE_LOW_BOUND', 'AE_TAG_FACE_HIGH_BOUND']) {
  test(`missing ${key} does not expose an unbounded Face detail result`, () => {
    const result = detail({ [key]: '-' });
    assert.equal(result.display.get(qualified('FLT', 'Link_FACE_CWR')), '-');
    assert.equal(result.display.get(qualified('TOP', 'Cal_FLT')), '-');
    assert.equal(result.display.get(qualified('TOP', 'Cal_Gain')), '-');
    assert.equal(result.display.get(qualified('FBT', 'BackTarget')), '250.0');
  });
}

const requests = [];
const field = (path, value, index = 0) => ({ path, value: String(value), index, line: index + 1 });
const chart = loadSelected(chartPath, [
  'calculateFaceTargetMetrics', 'loadFaceCwrBounds', 'previewFaceCwrBoundsFromDraft',
  'loadFaceFbtSource', 'loadFaceLinkTargetCalculator', 'FACE_NORMAL_TARGET_KEY', 'jumpToFaceCwrBoundSource',
], {
  cppGetFieldsAtPath: async (_filePath, path) => {
    requests.push(path);
    if (path === '[0][4][1].19') return [field(path, 300)];
    if (path === '[0][4][1].20') return [field(path, 500)];
    return [];
  },
});
const grid = value => ({ rowHeaders: [0], columnHeaders: [0], values: [[value]], fields: [], valueFields: [] });
const ratio = value => ({ rows: [{ values: ['0'] }, { values: [String(value)] }], fields: [] });
const source = {
  fdTh: grid(1024), nsFdTh: grid(1024), fdMinTh: grid(0), nsFdMinTh: grid(0), oeth: grid(1024), nsOeth: grid(1024),
  fddrRa: ratio(1024), fdszRa: ratio(512),
  faceProb: { rows: ['0', '512', '512', '1024', '1024'].map(value => ({ values: [value] })), fields: [] },
  faceStsSize: { x0: 0, x1: 1, fields: [] }, faceStsLoc: { x0: 0, x1: 1, fields: [] },
  cwrBounds: { low: 300, high: 500, fields: [] }, fields: [],
};
const inputs = {
  bv: 0, dr: 0, cwv: 1000, fdy: 1024, faceProb: 512, faceStsSize: 0, faceStsLoc: 0,
  nsProb: 0, exifNormalTarget: 100, parameterNormalTarget: 100, aeTarget: 1024, oeSys: 1024, fddr: 0, fdsz: 0,
  exifFdszRa: 512, useParameterFdszRaForExif: false, exifThreshold: 1024, fltMode: true,
  exifCwrLowBound: 200, exifCwrHighBound: 600,
};

test('Face Link card computes independent EXIF/AE.cpp limits after weighting', () => {
  const metrics = chart.calculateFaceTargetMetrics(source, inputs);
  assert.equal(metrics.rawBackSceneTarget, 550);
  assert.equal(metrics.rawExifBackSceneTarget, 550);
  assert.equal(metrics.backSceneTarget, 500, 'AE.cpp .19/.20 limits');
  assert.equal(metrics.exifBackSceneTarget, 550, 'EXIF bounds, not AE.cpp bounds');
  assert.deepEqual([metrics.lowLimit, metrics.highLimit, metrics.exifLowLimit, metrics.exifHighLimit], [300, 500, 200, 600]);
  const tight = chart.calculateFaceTargetMetrics(source, { ...inputs, exifCwrLowBound: 700, exifCwrHighBound: 900 });
  assert.equal(tight.exifBackSceneTarget, 700);
  assert.equal(tight.backSceneTarget, 500);
});

test('Face Link limits use AE_TAG_AE_TARGET, not NormalTarget, and keep fractional precision', () => {
  const metrics = chart.calculateFaceTargetMetrics({ ...source, cwrBounds: { low: 90, high: 91 } }, { ...inputs, aeTarget: 752, exifNormalTarget: 521, parameterNormalTarget: 521 });
  assert.equal(metrics.lowLimit, 752 * 90 / 1024);
  assert.equal(metrics.highLimit, 752 * 91 / 1024);
  assert.equal(metrics.backSceneTarget, metrics.highLimit);
  assert.equal(metrics.exifBackSceneTarget, 752 * 600 / 1024);
});

test('Face Link does not substitute EXIF limits for missing parameter limits or vice versa', () => {
  const noSource = chart.calculateFaceTargetMetrics(null, inputs);
  assert.equal(noSource.exifBackSceneTarget, 550, 'EXIF path remains usable without AE.cpp');
  assert.ok(Number.isNaN(noSource.backSceneTarget));
  const noParameterBounds = chart.calculateFaceTargetMetrics({ ...source, cwrBounds: null }, inputs);
  assert.ok(Number.isNaN(noParameterBounds.backSceneTarget));
  assert.equal(noParameterBounds.exifBackSceneTarget, 550);
  const noExifBounds = chart.calculateFaceTargetMetrics(source, { ...inputs, exifCwrHighBound: NaN });
  assert.ok(Number.isNaN(noExifBounds.exifBackSceneTarget));
  assert.equal(noExifBounds.backSceneTarget, 500);
  const noAeTarget = chart.calculateFaceTargetMetrics(source, { ...inputs, aeTarget: NaN });
  assert.ok(Number.isNaN(noAeTarget.backSceneTarget));
  assert.ok(Number.isNaN(noAeTarget.exifBackSceneTarget));
});

test('Face Link normalizes reversed/equal limits, allows zero and preserves the FDSZ source switch', () => {
  const reversed = chart.calculateFaceTargetMetrics({ ...source, cwrBounds: { low: 500, high: 300 } }, inputs);
  assert.equal(reversed.backSceneTarget, 500);
  const zero = chart.calculateFaceTargetMetrics({ ...source, cwrBounds: { low: 0, high: 0 } }, inputs);
  assert.equal(zero.backSceneTarget, 0);
  const switched = chart.calculateFaceTargetMetrics(source, { ...inputs, exifFdszRa: 0, useParameterFdszRaForExif: true });
  assert.equal(switched.exifBackSceneTarget, 550);
  assert.equal(switched.backSceneTarget, 500);
});

test('Back Scene Target mode remains unchanged even without any new limit inputs', () => {
  const metrics = chart.calculateFaceTargetMetrics(source, { ...inputs, fltMode: false, aeTarget: NaN, exifCwrLowBound: NaN, exifCwrHighBound: NaN });
  assert.equal(metrics.backSceneTarget, 550);
  assert.equal(metrics.backSceneTarget, metrics.rawBackSceneTarget);
  assert.equal(metrics.exifBackSceneTarget, 550);
});

test('parameter source loads only scalar .19/.20 and includes their fields in the shared snapshot', async () => {
  requests.length = 0;
  const bounds = await chart.loadFaceCwrBounds('AE.cpp');
  assert.deepEqual(requests, ['[0][4][1].19', '[0][4][1].20']);
  assert.deepEqual([bounds.low, bounds.high], [300, 500]);
  requests.length = 0;
  const loaded = await chart.loadFaceFbtSource('AE.cpp', true);
  assert.deepEqual([loaded.cwrBounds.low, loaded.cwrBounds.high], [300, 500]);
  assert.ok(loaded.fields.some(item => item.path === '[0][4][1].19'));
  assert.ok(loaded.fields.some(item => item.path === '[0][4][1].20'));
  requests.length = 0;
  const fbt = await chart.loadFaceFbtSource('AE.cpp', false);
  assert.equal(fbt.cwrBounds, null);
  assert.ok(!requests.some(path => ['[0][4][1].19', '[0][4][1].20'].includes(path)));
});

test('directory calculator preserves EXIF clamping without a parameter file', async () => {
  const calculate = await chart.loadFaceLinkTargetCalculator(null);
  const data = detailData({ [schema.FLT.CWV]: '1000', AE_TAG_FLT_TARGET: '1024', AE_TAG_FLT_FDSZ_RA: '512' });
  Object.assign(data, {
    AE_TAG_MTV6_MAINT_TARGET: '100', AE_TAG_HSV6_MAINT_WET: '1024',
    AE_TAG_HSV6_HS_WET: '0', AE_TAG_NS_PROB: '0',
  });
  data[chart.FACE_NORMAL_TARGET_KEY] = '999'; // Must not bypass the Normal card's calculation.
  const result = calculate(data, 'AE_TAG_REALBVX1000');
  assert.equal(result.faceLink.exif, 550);
  data.AE_TAG_FACE_HIGH_BOUND = '400';
  assert.equal(calculate(data, 'AE_TAG_REALBVX1000').faceLink.exif, 400);
  assert.ok(Number.isNaN(result.faceLink.calculated));
});

test('parameter bound loaders do not guess nearby array fields when a scalar is missing', async () => {
  const { loadFaceCwrBounds } = loadSelected(chartPath, ['loadFaceCwrBounds'], {
    cppGetFieldsAtPath: async (_filePath, path) => path.endsWith('.19')
      ? [field('[0][4][1][19].0', 999)] : [field(path, 500)],
  });
  const bounds = await loadFaceCwrBounds('AE.cpp');
  assert.ok(Number.isNaN(bounds.low));
  assert.equal(bounds.high, 500);
  assert.deepEqual(bounds.fields.map(item => item.path), ['[0][4][1].20']);
});

test('parameter bound draft changes are projected without mutating the original source', () => {
  const low = field('[0][4][1].19', 300, 0), high = field('[0][4][1].20', 500, 1);
  const original = { ...source, cwrBounds: { low: 300, high: 500, fields: [low, high] }, fields: [low, high] };
  const preview = chart.previewFaceCwrBoundsFromDraft(original, '350,\n450,');
  assert.deepEqual([preview.cwrBounds.low, preview.cwrBounds.high], [350, 450]);
  assert.equal(original.cwrBounds.low, 300);
  assert.equal(chart.calculateFaceTargetMetrics(preview, inputs).backSceneTarget, 450);
  const sameLine = { ...original, cwrBounds: { ...original.cwrBounds,
    fields: [low, { ...high, line: 1 }],
  }, fields: [low, { ...high, line: 1 }] };
  const inline = chart.previewFaceCwrBoundsFromDraft(sameLine, '350, 450,');
  assert.deepEqual([inline.cwrBounds.low, inline.cwrBounds.high], [350, 450]);
});

const bundle = JSON.parse(readFileSync(new URL('../src-tauri/resources/translations/zh_CN.json', import.meta.url), 'utf8'));
const t = (key, args = {}) => (bundle[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name) => String(args[name] ?? ''));
const { FaceLinkFormula } = loadSelected('../src/views/mtk/isp6s/ImagePane/FaceLinkFormula.tsx', ['FaceLinkFormula'], {
  Link: 'Link', FormulaHeader: 'FormulaHeader', useTranslation: () => ({ t }),
});
function nodesOfType(node, type) {
  if (node == null || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(child => nodesOfType(child, type));
  return [...(node.type === type ? [node] : []), ...nodesOfType(node.props?.children, type)];
}
const visibleText = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(visibleText).join('')
  : typeof node === 'object' ? visibleText(node.props?.children) : String(node);
const formulaCards = tree => nodesOfType(tree, 'FormulaHeader')[0].props.details.map(section => section.props.children[1]);

function chartFormulaProps(extra = {}, component = 'FaceLinkFormula') {
  // Evaluate the actual callsite props too, so row order and jump callbacks
  // cannot drift from FaceTabContent while the standalone summary still passes.
  const parsed = ts.createSourceFile(chartPath, readFileSync(new URL(chartPath, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let invocation;
  const visit = node => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsed) === component) invocation = node;
    ts.forEachChild(node, visit);
  };
  visit(parsed); assert.ok(invocation);
  const globals = {
    ...chart.calculateFaceTargetMetrics(source, inputs),
    ...loadSelected(chartPath, ['FACE_CWR_LOW_BOUND_KEY', 'FACE_CWR_HIGH_BOUND_KEY', 'FACE_CWR_LOW_BOUND_PATH', 'FACE_CWR_HIGH_BOUND_PATH', 'FACE_FLT_FDSZ_RA_KEY', 'FACE_FLT_FDSZ_SOURCE']),
    [component]: component, aeTarget: inputs.aeTarget,
    exifNormalTarget: inputs.exifNormalTarget, parameterNormalTarget: inputs.parameterNormalTarget,
    exifCwrLowBound: inputs.exifCwrLowBound, exifCwrHighBound: inputs.exifCwrHighBound,
    currentSource: source, useParameterFdszRaForExif: false, sourceDraftTextRef: { current: '' },
    lowBoundField: null, highBoundField: null, onSourceJump: undefined, ...chart, ...extra,
  };
  const { outputText } = ts.transpileModule(`module.exports = ${invocation.getText(parsed)};`, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } });
  const module = { exports: {} }, jsx = (type, props) => ({ type, props });
  new Function('require', 'module', 'exports', ...Object.keys(globals), outputText)(
    id => { assert.equal(id, 'react/jsx-runtime'); return { jsx, jsxs: jsx }; },
    module, module.exports, ...Object.values(globals),
  );
  return module.exports.props;
}

test('Face Link summary has two compact rows and moves full math into click-only source help', () => {
  const tree = FaceLinkFormula(chartFormulaProps());
  const rows = nodesOfType(tree, 'tr').slice(1);
  const hints = formulaCards(tree).map(visibleText);
  assert.equal(rows.length, 2);
  assert.equal(nodesOfType(tree, 'th').filter(node => node.props.scope === 'col').map(visibleText).join('|'),
    '来源|加权值|边界显示|限制范围|最终值');
  assert.match(visibleText(rows[0]), /EXIF550下限200上限600\[200, 600\]550范围内/);
  assert.match(visibleText(rows[1]), /参数计算550下限300上限500\[300, 500\]500已压至上限/);
  assert.doesNotMatch(visibleText(tree), /limit\(|AE_TAG_FACE_|1024/);
  assert.match(hints[0], /limit\(550\.0, 200\.0, 600\.0\) = 550\.0/);
  assert.match(hints[0], /low_bound200\.0EXIF · AE_TAG_FACE_LOW_BOUND/);
  assert.match(hints[0], /high_bound600\.0EXIF · AE_TAG_FACE_HIGH_BOUND/);
  assert.match(hints[1], /limit\(550\.0, 300\.0, 500\.0\) = 500\.0/);
  assert.match(hints[1], /low_bound300\.0AE.cpp · \[0\]\[4\]\[1\]\.19/);
  assert.match(hints[1], /high_bound500\.0AE.cpp · \[0\]\[4\]\[1\]\.20/);
  assert.ok(rows.every(row => row.props.tabIndex === undefined && !row.props.title));
  assert.equal(nodesOfType(tree, 'Tooltip').length, 0);
  assert.deepEqual(nodesOfType(tree, 'Link').map(link => visibleText(link)), ['300', '500']);
  assert.doesNotMatch(visibleText(tree), /\[0\]\[4\]\[1\]\.19|\[0\]\[4\]\[1\]\.20/);
});

test('boundary column displays independent EXIF and parameter coefficients instead of paths or scaled limits', () => {
  const props = chartFormulaProps();
  props.exif = { ...props.exif, lowBound: 90, highBound: 9000, lowLimit: 66.09375, highLimit: 6609.375 };
  props.parameter = { ...props.parameter, lowBound: 100, highBound: 8000 };
  const tree = FaceLinkFormula(props);
  const groups = nodesOfType(tree, 'div').filter(node => node.props.role === 'group');
  assert.equal(groups.length, 2);
  assert.equal(groups[0].props['aria-label'], 'EXIF 边界：');
  assert.equal(groups[1].props['aria-label'], '参数边界：');
  assert.match(visibleText(groups[0]), /下限90上限9000/);
  assert.match(visibleText(groups[1]), /下限100上限8000/);
  const table = nodesOfType(tree, 'table')[0];
  const rows = nodesOfType(table, 'tr').slice(1);
  assert.deepEqual(nodesOfType(rows[0], 'td').map(visibleText), ['550', '下限90上限9000', '[66, 6609]', '550范围内']);
  assert.deepEqual(nodesOfType(rows[1], 'td').map(visibleText), ['550', '下限100上限8000', '[300, 500]', '500已压至上限']);
  assert.equal(nodesOfType(tree, 'table').length, 1);
  assert.equal(nodesOfType(table, 'div').filter(node => node.props.role === 'group').length, 2, 'both groups are inside the table');
  assert.equal(nodesOfType(groups[0], 'Link').length, 0, 'EXIF coefficients are read-only, not AE.cpp jump controls');
  const exifHint = visibleText(formulaCards(tree)[0]);
  assert.match(exifHint, /low_bound90\.0EXIF · AE_TAG_FACE_LOW_BOUND/);
  assert.match(exifHint, /high_bound9000\.0EXIF · AE_TAG_FACE_HIGH_BOUND/);
  assert.deepEqual(nodesOfType(groups[1], 'Link').map(node => visibleText(node)), ['100', '8000']);
  assert.match(nodesOfType(groups[1], 'Link')[0].props['aria-label'], /\[0\]\[4\]\[1\]\.19/);
  assert.match(nodesOfType(groups[1], 'Link')[1].props['aria-label'], /\[0\]\[4\]\[1\]\.20/);
});

test('zero remains a clickable coefficient while missing parameter values stay disabled and independent of EXIF', () => {
  const low = field('[0][4][1].19', 0, 0), high = field('[0][4][1].20', 500, 1);
  const currentSource = { ...source, fields: [low, high], cwrBounds: { low: 0, high: NaN, fields: [low, high] } };
  const calls = [];
  const tree = FaceLinkFormula(chartFormulaProps({ currentSource, lowBoundField: low, highBoundField: high,
    onSourceJump: (...args) => calls.push(args) }));
  const links = nodesOfType(tree, 'Link');
  assert.equal(visibleText(links[0]), '0'); assert.equal(links[0].props.disabled, false);
  links[0].props.onClick(); assert.equal(calls[0][1].paths[0], low.path);
  assert.equal(visibleText(links[1]), '-'); assert.equal(links[1].props.disabled, true);
  assert.equal(links[1].props.onClick, undefined);
  const exifGroup = nodesOfType(tree, 'div').find(node => node.props.role === 'group');
  assert.match(visibleText(exifGroup), /下限200上限600/);
});

test('integer summary and one-decimal hints preserve internal precision and missing-data status', () => {
  const props = chartFormulaProps();
  props.exif = { ...props.exif, rawTarget: 1886.049, lowLimit: 66.09375, highLimit: 6609.375, result: 1886.049 };
  props.parameter = { ...props.parameter, lowLimit: 500, highLimit: 300, result: 500 };
  const tree = FaceLinkFormula(props);
  const rows = nodesOfType(tree, 'tr').slice(1);
  const hint = visibleText(formulaCards(tree)[0]);
  assert.match(hint, /limit\(1886\.0, 66\.1, 6609\.4\) = 1886\.0/);
  assert.ok(visibleText(rows[0]).includes('[66, 6609]1886'));
  assert.doesNotMatch(hint, /1886\.049|66\.09375|6609\.375/);
  assert.equal(props.exif.rawTarget, 1886.049, 'formatting cannot change calculator inputs');
  assert.equal(props.exif.lowLimit, 66.09375);
  assert.ok(visibleText(rows[1]).includes('[300, 500]'));
  props.parameter = { ...props.parameter, result: NaN, highLimit: NaN };
  const missing = nodesOfType(FaceLinkFormula(props), 'tr').at(-1);
  assert.match(visibleText(missing), /数据不全/);
  assert.equal(nodesOfType(missing, 'strong')[0].props.children, '-');
  props.parameter = { ...props.parameter, rawTarget: 100, lowLimit: 200, highLimit: 600, result: 200 };
  assert.match(visibleText(nodesOfType(FaceLinkFormula(props), 'tr').at(-1)), /已抬至下限/);
});

test('formula cards separate calculations from source columns without changing numeric precision', () => {
  const props = chartFormulaProps({ useParameterFdszRaForExif: true });
  props.exif = { ...props.exif, rawTarget: 1509.9675516224188, result: 1509.9675516224188, lowLimit: 66.09375, highLimit: 6609.375 };
  const tree = FaceLinkFormula(props), row = nodesOfType(tree, 'tr')[1];
  const help = nodesOfType(tree, 'FormulaHeader')[0];
  const card = formulaCards(tree)[0], hint = visibleText(card);
  const sections = nodesOfType(card, 'section');
  assert.equal(sections.length, 4);
  for (const [index, heading] of ['[1] 加权计算', '[2] 极值范围', '[3] 最终结果', '数值来源'].entries()) assert.ok(visibleText(sections[index]).startsWith(heading));
  assert.match(hint, /limit\(1510\.0, 66\.1, 6609\.4\) = 1510\.0/);
  const sourceRows = nodesOfType(nodesOfType(card, 'dl')[0], 'div');
  assert.equal(sourceRows.length, 5);
  assert.deepEqual(nodesOfType(sourceRows[1], 'dt').map(visibleText), ['FDSZ_RA']);
  assert.match(visibleText(sourceRows[1]), /FDSZ_RA512\.0AE.cpp · face_sz: \[0\]\[4\]\[1\]\[47\]/);
  assert.match(visibleText(sourceRows[0]), /AE_Target1024\.0EXIF · AE_TAG_AE_TARGET/);
  assert.doesNotMatch(hint, /\d+\.\d{2,}/, 'no long floating-point expansions in the formula hint');
  assert.ok(nodesOfType(row, 'td').every(cell => !/\d+\.\d+/.test(visibleText(cell))), 'all summary cells use integers');
  assert.ok(nodesOfType(tree, 'Link').every(link => /当前值 \d+\.\d）/.test(link.props['aria-label'])));
  const comparison = help.props.sources.find(entry => entry.name === 'FDSZ_RA');
  assert.equal(comparison.exif.value, props.exif.weight);
  assert.equal(comparison.parameter.value, props.parameter.weight);
  assert.match(comparison.exif.source, /face_sz/);
  assert.equal(nodesOfType(tree, 'Tooltip').length, 0);
});

test('monospaced tooltip styling is opt-in and leaves ordinary tooltips unchanged', () => {
  const { TooltipPortal, readGlobalTooltipMonospace } = loadSelected('../src/components/common/HoverTooltip.tsx', ['TooltipPortal', 'readGlobalTooltipMonospace'], {
    createPortal: node => node, document: { body: {} },
  });
  assert.equal(readGlobalTooltipMonospace({ getAttribute: () => null }), false);
  assert.equal(readGlobalTooltipMonospace({ getAttribute: () => 'true' }), true);
  assert.equal(readGlobalTooltipMonospace({ getAttribute: () => 'false' }), false);
  const props = { refNode: { current: null }, content: 'raw = 1510.0', coords: { left: 20, top: 20, placement: 'below', arrowLeft: 12 },
    theme: { background: 'var(--colorNeutralBackground1)', borderColor: 'var(--colorNeutralStroke2)', color: 'var(--colorNeutralForeground1)', boxShadow: 'none' },
    wrap: true, maxWidth: 720 };
  const formula = TooltipPortal({ ...props, monospace: true });
  assert.match(formula.props.style.fontFamily, /Consolas.*monospace/);
  assert.equal(formula.props.style.fontVariantNumeric, 'tabular-nums');
  assert.match(formula.props.className, /text-xs leading-5/);
  assert.equal(formula.props.style.whiteSpace, 'pre-wrap');
  const ordinary = TooltipPortal(props);
  assert.equal(ordinary.props.style.fontFamily, undefined);
  assert.match(ordinary.props.className, /text-\[11px\] leading-4/);
});

test('both parameter hyperlinks switch to parameter mapping with the exact path and draft token', () => {
  const panePath = '../src/views/mtk/isp6s/ImagePane/ImagePane.tsx';
  const parsed = ts.createSourceFile(panePath, readFileSync(new URL(panePath, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'handleSourceJump') handler = node;
    ts.forEachChild(node, visit);
  };
  visit(parsed); assert.ok(handler);
  const events = [], globals = { activeFilePath: 'C:/tuning/AE.cpp', useCallback: callback => callback,
    setSourceOverride: value => events.push(['selection', value]), onMode: value => events.push(['mode', value]) };
  const module = { exports: {} };
  const { outputText } = ts.transpileModule(`const ${handler.getText(parsed)}; module.exports = handleSourceJump;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  new Function('module', ...Object.keys(globals), outputText)(module, ...Object.values(globals));
  const low = field('[0][4][1].19', 90, 0), high = field('[0][4][1].20', 9000, 1);
  high.line = low.line; // Same-line source values must select different tokens.
  const currentSource = { ...source, fields: [low, high], cwrBounds: { low: 95, high: 8800, fields: [low, high] } };
  const tree = FaceLinkFormula(chartFormulaProps({ currentSource, lowBoundField: low, highBoundField: high,
    sourceDraftTextRef: { current: '95, 8800,' }, onSourceJump: module.exports }));
  const links = nodesOfType(tree, 'Link');
  assert.ok(links.every(link => link.props.as === 'button' && !link.props.disabled));
  assert.deepEqual(links.map(link => visibleText(link)), ['95', '8800'], 'the displayed coefficient itself is the jump control');
  links[0].props.onClick(); links[1].props.onClick();
  assert.deepEqual(events.filter(([kind]) => kind === 'mode'), [['mode', 'param_map'], ['mode', 'param_map']]);
  const selections = events.filter(([kind]) => kind === 'selection').map(([, value]) => value);
  assert.deepEqual(selections.map(value => value.spec), [
    { paths: ['[0][4][1].19'], jump_to: 'first', highlight: 'ranges' },
    { paths: ['[0][4][1].20'], jump_to: 'first', highlight: 'ranges' },
  ]);
  assert.deepEqual(selections.map(value => value.details.selection), [
    { line: 1, value: '95', ordinal: 0 }, { line: 1, value: '8800', ordinal: 1 },
  ]);
  assert.ok(selections.every(value => value.filePath === globals.activeFilePath));
});

test('missing source fields or jump capability cannot create an active parameter link', () => {
  const links = nodesOfType(FaceLinkFormula(chartFormulaProps()), 'Link');
  assert.ok(links.every(link => link.props.disabled && !link.props.onClick));
  const low = field('[0][4][1].19', 90), high = field('[0][4][1].20', 9000);
  const withoutHandler = FaceLinkFormula(chartFormulaProps({ lowBoundField: low, highBoundField: high }));
  assert.ok(nodesOfType(withoutHandler, 'Link').every(link => link.props.disabled));
  const invalidLine = FaceLinkFormula(chartFormulaProps({ lowBoundField: { ...low, line: 0 }, highBoundField: { ...high, line: 0 }, onSourceJump: () => {} }));
  assert.ok(nodesOfType(invalidLine, 'Link').every(link => link.props.disabled));
  const switched = chartFormulaProps({ useParameterFdszRaForExif: true });
  assert.match(switched.exif.weightSource, /face_sz: \[0\]\[4\]\[1\]\[47\].*face_sz_ra: \[0\]\[4\]\[1\]\[48\]/);
  assert.match(switched.exif.lowBoundSource, /AE_TAG_FACE_LOW_BOUND/);
  assert.match(switched.exif.highBoundSource, /AE_TAG_FACE_HIGH_BOUND/);
  const calls = [];
  chart.jumpToFaceCwrBoundSource((...args) => calls.push(args), source, '[0][4][1].19', '');
  chart.jumpToFaceCwrBoundSource((...args) => calls.push(args), source, '[0][4][1][19]', '');
  assert.equal(calls.length, 0);
});

test('all five summary locales have complete matching keys and interpolation fields', () => {
  let shape;
  for (const locale of ['zh_CN', 'zh_TW', 'en_US', 'ja_JP', 'tr_TR']) {
    const values = JSON.parse(readFileSync(new URL(`../src-tauri/resources/translations/${locale}.json`, import.meta.url), 'utf8'));
    const keys = Object.keys(values).filter(key => key.startsWith('face_link_formula.')).sort();
    assert.equal(keys.length, 22);
    const current = keys.map(key => [key, [...values[key].matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]).sort()]);
    if (shape) assert.deepEqual(current, shape, locale); else shape = current;
  }
});

test('image list requests all three extra fields needed by the shared clamp calculator', () => {
  const { FACE_LINK_TARGET_IMAGE_KEYS } = loadSelected('../src/views/mtk/isp6s/TablePane/TablePane.tsx', ['FACE_LINK_TARGET_IMAGE_KEYS']);
  for (const key of ['AE_TAG_AE_TARGET', 'AE_TAG_FACE_LOW_BOUND', 'AE_TAG_FACE_HIGH_BOUND']) assert.ok(FACE_LINK_TARGET_IMAGE_KEYS.includes(key), key);
});

const normal = loadSelected(chartPath, [
  'readNormalTargetFormulaSource', 'calculateNormalTargetFormula', 'calculateParameterNormalTargetFormula',
  'previewHsWeightSourceFromDraft', 'previewHsAreaSourceFromDraft',
  'interpolateHsWeightSource', 'interpolateHsAreaSource', 'hsWeightChannelIndex',
  'HS_TARGET_INPUTS', 'HS_TARGET_WEIGHT_TONE_BY_ID', 'HS_BRIGHT_AREA_SOURCE_CONFIG',
  'HS_MIDDLE_AREA_SOURCE_CONFIG', 'HS_DARK_AREA_SOURCE_CONFIG', 'HS_MIDDLE_CORR_B2M_KEY',
  'HS_WEIGHT_BV_PATH', 'HS_WEIGHT_DR_B2D_PATH', 'HS_WEIGHT_MID_PATH', 'HS_WEIGHT_VALUE_PATH',
  'MAIN_TARGET_CWV_KEY', 'MTWV_VALUE_KEY',
]);
const normalExifData = {
  AE_TAG_MTV6_MAINT_TARGET: '90', AE_TAG_HSV6_MAINT_WET: '435',
  AE_TAG_HSV6_BT_TARGET: '130', AE_TAG_HSV6_MT_TARGET: '230', AE_TAG_HSV6_DT_TARGET: '330',
  AE_TAG_HSV6_BT_WET: '335', AE_TAG_HSV6_MT_WET: '235', AE_TAG_HSV6_DT_WET: '135',
  AE_TAG_HSV6_HS_TARGET: '250', AE_TAG_HSV6_HS_WET: '705',
  AE_TAG_NS_FINAL_TARGET: '400', AE_TAG_NS_PROB: '512',
};
const sourceValue = (formula, name) => formula.sourceValues.find(entry => entry.name === name);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('Normal Target keeps six HS details and uses the recorded aggregate tags exactly once', () => {
  const formula = normal.calculateNormalTargetFormula(normal.readNormalTargetFormulaSource(normalExifData));
  for (const [tone, target, weight] of [['BT', 130, 335], ['MT', 230, 235], ['DT', 330, 135]]) {
    assert.equal(sourceValue(formula, `HS_${tone}_Tar`).value, target);
    assert.equal(sourceValue(formula, `HS_${tone}_Wt`).value, weight);
  }
  assert.equal(sourceValue(formula, 'HS_Tar').source, 'EXIF · AE_TAG_HSV6_HS_TARGET');
  assert.equal(sourceValue(formula, 'HS_Wt').source, 'EXIF · AE_TAG_HSV6_HS_WET');
  close(formula.mtHsTarget, (90 * 435 + 250 * 705) / 1140);
  close(formula.finalTarget, ((90 * 435 + 250 * 705) / 1140 + 400) / 2);
  const older = { ...normalExifData };
  delete older.AE_TAG_HSV6_HS_TARGET; delete older.AE_TAG_HSV6_HS_WET;
  const fallback = normal.calculateNormalTargetFormula(normal.readNormalTargetFormulaSource(older));
  close(fallback.mtHsTarget, (90 * 435 + 130 * 335 + 230 * 235 + 330 * 135) / 1140);
  assert.match(sourceValue(fallback, 'HS_Tar').source, /HS_BT_Tar/);
  assert.notEqual(fallback.finalTarget, formula.finalTarget);
});

test('Normal Target does not turn missing active inputs into zero, and ignores inactive branches', () => {
  const input = { mainTarget: 100, mainWeight: 435, hsTargets: [130, 230, 330], hsWeights: [335, 235, 135], nsTarget: 400, nsProb: 512 };
  const calculate = normal.calculateParameterNormalTargetFormula;
  for (const changes of [{ mainTarget: NaN }, { mainWeight: NaN }, { hsTargets: [NaN, 230, 330] },
    { hsWeights: [NaN, 235, 135] }, { hsWeights: [-1, 235, 135] }, { nsTarget: NaN }, { nsProb: NaN }, { nsProb: 1025 }]) {
    assert.ok(Number.isNaN(calculate({ ...input, ...changes }).finalTarget));
  }
  assert.equal(calculate({ ...input, hsTargets: [NaN, NaN, NaN], hsWeights: [0, 0, 0], nsProb: 0, nsTarget: NaN }).finalTarget, 100);
  assert.equal(calculate({ ...input, mainTarget: NaN, mainWeight: NaN, hsWeights: [NaN, NaN, NaN], nsProb: 1024 }).finalTarget, 400);
  assert.equal(calculate({ ...input, mainTarget: 0, hsTargets: [0, 0, 0], nsProb: 0 }).finalTarget, 0);
  const missingTag = normal.calculateNormalTargetFormula({ ...normal.readNormalTargetFormulaSource(normalExifData), hsTarget: '-' });
  assert.ok(Number.isNaN(missingTag.finalTarget), 'an explicitly invalid aggregate must not silently fall back');
});

// Real HS parser paths, with nonconstant values on all three weight axes and
// both area axes. Only unrelated Face/MainT/NS source loading is stubbed.
function hsFixture(edit = '') {
  const groups = new Map(), fields = [];
  const add = (prefix, path, value) => {
    const entry = field(path, value, fields.length);
    fields.push(entry);
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(entry);
  };
  for (const path of [normal.HS_WEIGHT_BV_PATH, normal.HS_WEIGHT_MID_PATH]) {
    [0, 10].forEach((value, i) => add(path, `${path}.${i}`, value));
  }
  for (let bv = 0; bv < 2; bv++) {
    [0, 10].forEach((value, dr) => add(normal.HS_WEIGHT_DR_B2D_PATH, `${normal.HS_WEIGHT_DR_B2D_PATH}[${bv}].${dr}`, value));
    for (let dr = 0; dr < 2; dr++) for (let mid = 0; mid < 2; mid++) {
      [400, 100, 200, 300].forEach((base, channel) => add(normal.HS_WEIGHT_VALUE_PATH,
        `${normal.HS_WEIGHT_VALUE_PATH}[${bv}][${dr}][${mid}].${channel}`,
        base + bv * 40 + dr * 20 + mid * 10 + (edit === 'weight' && channel === 1 ? 200 : 0)));
    }
  }
  [normal.HS_BRIGHT_AREA_SOURCE_CONFIG, normal.HS_MIDDLE_AREA_SOURCE_CONFIG, normal.HS_DARK_AREA_SOURCE_CONFIG].forEach((config, tone) => {
    [config.rowHeaderPath, config.columnHeaderPath].forEach(path => {
      [0, 10].forEach((value, i) => add(path, `${path}.${i}`, value));
    });
    for (let bv = 0; bv < 2; bv++) for (let axis = 0; axis < 2; axis++) {
      add(config.valuePath, `${config.valuePath}[${bv}].${axis}`, (tone + 1) * 10 + bv * 4 + axis * 2 + (edit === ['bright', 'middle', 'dark'][tone] ? 10 : 0));
    }
  });
  return { groups, fields, draft: fields.map(entry => `${entry.value},`).join('\n') };
}
const fixtureData = {
  ...normalExifData, AE_TAG_CWV: '1000', [normal.MAIN_TARGET_CWV_KEY]: '2000',
  [normal.MTWV_VALUE_KEY]: '1000', AE_TAG_REALBVX1000: '5', AE_TAG_DRV6_B2D: '5', AE_TAG_DRV6_MIDRATIO: '5',
  [normal.HS_MIDDLE_CORR_B2M_KEY]: '5', AE_TAG_HS_EVD: '5', AE_TAG_DRV6_CORR_MIDRATIO: '0',
  AE_TAG_HSV6_BT_Final_Y: '100', AE_TAG_HSV6_MT_Final_Y: '100', AE_TAG_HSV6_DT_Final_Y: '100',
  AE_TAG_NS_STS_CDF: '5', AE_TAG_NS_EVD: '5',
  NS_LOWBND_THD: '40', NS_LOWBND_Y: '100', NS_Y: '100', NS_BrightTone_Y: '100',
};
const areaSource = { bvValues: [0, 10], thdValues: [40, 40], flatSettings: { flatThd: { value: 40 } }, flatProb: { x0: 0, x1: 10, y0: 0, y1: 0 } };
const hsPipeline = loadSelected(chartPath, ['loadFaceLinkTargetCalculator', 'loadHsWeightSource', 'loadHsBrightAreaSource', 'loadHsMiddleAreaSource', 'loadHsDarkAreaSource'], {
  cppGetFieldsAtPath: async (path, prefix) => hsFixture(path === 'base' ? '' : path).groups.get(prefix) ?? [],
  loadFaceFbtSource: async () => ({ ...source, cwrBounds: { low: 0, high: 5000 } }),
  loadMainTargetThreshold: async () => ['BV', 'Base', 'Exp'].map((label, i) => ({ label, values: [String([0, 50, 0][i])] })),
  loadMainTargetMidCurve: async () => null,
  loadNsLowBndBounds: async () => ({ low: 0, limit: 1000 }),
  loadNsProbabilityCurveSource: async () => ({ bv: { x0: 0, x1: 10, y0: 512, y1: 512 }, cdf: { x0: 0, x1: 10, y0: 1024, y1: 1024 } }),
  loadNsNorTSource: async () => areaSource, loadNsBTSource: async () => areaSource,
});

async function hsSources(path) {
  return Promise.all([hsPipeline.loadHsWeightSource(path), hsPipeline.loadHsBrightAreaSource(path), hsPipeline.loadHsMiddleAreaSource(path), hsPipeline.loadHsDarkAreaSource(path)]);
}
function hsCardFormula([weight, ...areas]) {
  const wet = tone => normal.interpolateHsWeightSource(weight, normal.hsWeightChannelIndex(tone), 5, 5, 5);
  return normal.calculateParameterNormalTargetFormula({
    mainTarget: 100, mainWeight: wet('target'),
    hsTargets: areas.map(area => 1000 * normal.interpolateHsAreaSource(area, 5, 5) / 100),
    hsWeights: ['bright', 'middle', 'dark'].map(wet), nsTarget: 400, nsProb: 512,
  });
}

test('HS interpolated six-term values and directory Normal_new share full precision', async () => {
  const sources = await hsSources('base');
  const formula = hsCardFormula(sources);
  for (const [tone, target, weight] of [['BT', 130, 335], ['MT', 230, 235], ['DT', 330, 135]]) {
    assert.equal(sourceValue(formula, `HS_${tone}_Tar`).value, target);
    assert.equal(sourceValue(formula, `HS_${tone}_Wt`).value, weight);
    assert.match(sourceValue(formula, `HS_${tone}_Tar`).source, /Area THD.*interp.*Final_Y/);
    assert.match(sourceValue(formula, `HS_${tone}_Wt`).source, /HS Weight.*interp/);
  }
  close(sourceValue(formula, 'HS_Tar').value, 142150 / 705);
  assert.equal(sourceValue(formula, 'HS_Wt').value, 705);
  close(formula.finalTarget, ((100 * 435 + 142150) / 1140 + 400) / 2);
  const calculate = await hsPipeline.loadFaceLinkTargetCalculator('base');
  const result = calculate(fixtureData, 'AE_TAG_REALBVX1000');
  assert.equal(result.normal.calculated, formula.finalTarget);
  const metrics = loadSelected('../src/views/mtk/isp6s/TablePane/imageTableMetrics.ts', ['deltaEv', 'formatDeltaEv']);
  const { imageFaceTargetValues, imageTableFormulaAlias } = loadSelected('../src/views/mtk/isp6s/TablePane/TablePane.tsx', ['imageFaceTargetValues', 'imageTableFormulaAlias'], metrics);
  const values = imageFaceTargetValues(result);
  assert.equal(values.normalCwr, '294(281)');
  assert.equal(imageTableFormulaAlias('Normal_old', values, true), '294');
  assert.equal(imageTableFormulaAlias('Normal_new', values, true), '281');
  const noMainCwv = { ...fixtureData };
  delete noMainCwv[normal.MAIN_TARGET_CWV_KEY];
  assert.ok(Number.isNaN(calculate(noMainCwv, 'AE_TAG_REALBVX1000').normal.calculated), 'MainT cannot borrow the Face CWV fallback');
  const hsFallback = { ...fixtureData };
  delete hsFallback.AE_TAG_CWV;
  close(calculate(hsFallback, 'AE_TAG_REALBVX1000').normal.calculated, ((100 * 435 + 2 * 142150) / 1140 + 800) / 2);
  const noFile = await hsPipeline.loadFaceLinkTargetCalculator(null);
  assert.ok(Number.isNaN(noFile(fixtureData, 'AE_TAG_REALBVX1000').normal.calculated));
});

for (const edit of ['bright', 'middle', 'dark', 'weight']) {
  test(`editing HS ${edit} updates draft/card and applied list Normal_new while preserving Normal_old`, async () => {
    const original = await hsSources('base');
    const baseline = hsCardFormula(original);
    const draft = hsFixture(edit).draft;
    const projected = [normal.previewHsWeightSourceFromDraft(original[0], draft), ...original.slice(1).map(area => normal.previewHsAreaSourceFromDraft(area, draft))];
    const updated = hsCardFormula(projected);
    assert.notEqual(updated.finalTarget, baseline.finalTarget);
    assert.equal(hsCardFormula(original).finalTarget, baseline.finalTarget, 'preview does not mutate loaded sources');
    const calculate = await hsPipeline.loadFaceLinkTargetCalculator(edit);
    const before = (await hsPipeline.loadFaceLinkTargetCalculator('base'))(fixtureData, 'AE_TAG_REALBVX1000');
    const after = calculate(fixtureData, 'AE_TAG_REALBVX1000');
    close(after.normal.calculated, updated.finalTarget);
    assert.equal(after.normal.exif, before.normal.exif);
    const reverted = [normal.previewHsWeightSourceFromDraft(original[0], hsFixture().draft), ...original.slice(1).map(area => normal.previewHsAreaSourceFromDraft(area, hsFixture().draft))];
    assert.equal(hsCardFormula(reverted).finalTarget, baseline.finalTarget);
  });
}

test('HS area axis drafts recompute interpolation and same-line tokens stay independent', async () => {
  const [, area] = await hsSources('base');
  const lines = hsFixture().draft.split('\n');
  lines[area.rowHeaderFields[1].line - 1] = '20,';
  const updated = normal.previewHsAreaSourceFromDraft(area, lines.join('\n'));
  assert.equal(normal.interpolateHsAreaSource(updated, 5, 5), 12);
  assert.equal(normal.interpolateHsAreaSource(area, 5, 5), 13);
  const first = field('[0][3][1][28][0].0', 10, 0), second = { ...field('[0][3][1][28][0].1', 12, 1), line: 1 };
  const inline = { ...area, fields: [first, second], rowHeaderFields: [], columnHeaderFields: [], valueFields: [[first, second]], values: [[10, 12]] };
  assert.deepEqual(normal.previewHsAreaSourceFromDraft(inline, '14, 18,').values, [[14, 18]]);
});

test('HS Weight BV/B2D/Mid axis drafts change the same trilinear interpolation used by Normal Target', async () => {
  const [weight] = await hsSources('base');
  const interpolate = entry => normal.interpolateHsWeightSource(entry, normal.hsWeightChannelIndex('bright'), 5, 5, 5);
  assert.equal(interpolate(weight), 335);
  for (const [entry, expected] of [[weight.bvAxisFields[1], 325], [weight.drB2dFields[0][1], 332.5], [weight.midAxisFields[1], 332.5]]) {
    const lines = hsFixture().draft.split('\n');
    lines[entry.line - 1] = '20,';
    assert.equal(interpolate(normal.previewHsWeightSourceFromDraft(weight, lines.join('\n'))), expected);
    assert.equal(interpolate(weight), 335);
  }
  assert.equal(normal.previewHsWeightSourceFromDraft(weight, hsFixture().draft), weight, 'unchanged drafts retain the loaded object');
});

test('HS and NS keep source identity across temporary draft revisions but isolate a different file', () => {
  const parsed = ts.createSourceFile(chartPath, readFileSync(new URL(chartPath, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'sourceIdentity') callback = node.initializer.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(parsed);
  assert.ok(callback);
  const identity = new Function('filePath', 'sourceBasePath', 'sourceRevision', 'tab', 'isFaceTab', `return (${callback.getText(parsed)})();`);
  const original = identity('AE.cpp', 'AE.cpp', 0, 'HS', false);
  assert.equal(identity('temp.cpp', 'AE.cpp', 1, 'HS', false), original);
  assert.equal(identity('temp.cpp', 'AE.cpp', 0, 'HS', false), original, 'pending temp write must preserve HS state too');
  assert.equal(identity('temp.cpp', 'AE.cpp', 2, 'HS', false), original);
  const nsOriginal = identity('AE.cpp', 'AE.cpp', 0, 'NS', false);
  assert.equal(identity('temp.cpp', 'AE.cpp', 1, 'NS', false), nsOriginal);
  assert.equal(identity('temp.cpp', 'AE.cpp', 0, 'NS', false), nsOriginal);
  assert.notEqual(identity('other.cpp', 'other.cpp', 0, 'NS', false), nsOriginal);
  assert.notEqual(identity('other.cpp', 'other.cpp', 0, 'HS', false), original);
  assert.notEqual(identity('AE.cpp', 'AE.cpp', 0, 'MainT', false), identity('temp.cpp', 'AE.cpp', 1, 'MainT', false));
});

test('HS Weight BV edits retain row reconciliation keys and do not restart resize subscriptions', async () => {
  const [source] = await hsSources('base');
  const dependencies = [];
  const { HsWeightGrid, previewHsWeightSourceTarget } = loadSelected(chartPath, ['HsWeightGrid', 'previewHsWeightSourceTarget'], {
    useRef: () => ({ current: null }), useState: value => [value, () => {}],
    useLayoutEffect: (_, deps) => { dependencies.push(deps); }, Fragment: 'fragment', HsWeightEditableCell: 'HsWeightEditableCell',
  });
  const selected = { bvIndexes: new Set(), midIndexes: new Set(), drIndexesByBv: new Map() };
  const render = value => HsWeightGrid({ source: value, selected, editable: true });
  const rowKeys = tree => nodesOfType(tree, 'div').filter(node => node.props.children?.[0]?.props?.title === 'BV').map(node => node.key);
  const before = render(source);
  const after = render(previewHsWeightSourceTarget(source, { kind: 'bv', bvIndex: 0 }, '250'));
  assert.equal(rowKeys(before).length, 2);
  assert.deepEqual(rowKeys(after), rowKeys(before), 'typing a BV value must not replace that group of inputs');
  assert.deepEqual(dependencies[0], dependencies[1], 'numeric edits must not disconnect and reattach the layout observer');
});

test('HS Weight save tracks all axes/channels, focused previews, committed edits and saved state', async () => {
  const [source] = await hsSources('base');
  const saved = hsFixture().draft;
  const api = loadSelected(chartPath, [
    'hsWeightHasUnsavedChanges', 'previewHsWeightSourceTarget', 'getHsWeightTargetField', 'replaceHsWeightCellInSourceText',
  ]);
  assert.equal(api.hsWeightHasUnsavedChanges(source, saved, saved), false);
  assert.equal(api.hsWeightHasUnsavedChanges(null, saved, saved), false);
  assert.equal(api.hsWeightHasUnsavedChanges(source, saved, null), false);
  assert.equal(api.hsWeightHasUnsavedChanges(source, saved + '\n// another card edit', saved), false);
  const targets = [
    { kind: 'bv', bvIndex: 0 }, { kind: 'dr', bvIndex: 0, drIndex: 0 }, { kind: 'mid', midIndex: 0 },
    ...[0, 1, 2, 3].map(channelIndex => ({ kind: 'value', bvIndex: 0, drIndex: 0, midIndex: 0, channelIndex })),
  ];
  for (const target of targets) {
    const field = api.getHsWeightTargetField(source, target);
    const preview = api.previewHsWeightSourceTarget(source, target, '999');
    assert.equal(api.hsWeightHasUnsavedChanges(preview, saved, saved), true, `${target.kind}: focused preview enables Save`);
    const committed = api.replaceHsWeightCellInSourceText(saved, source, field, '999');
    assert.ok(committed);
    assert.equal(api.hsWeightHasUnsavedChanges(source, committed, saved), true);
    const current = normal.previewHsWeightSourceFromDraft(source, committed);
    assert.equal(api.hsWeightHasUnsavedChanges(current, committed, committed), false, 'successful save clears dirty state');
    const reverted = api.previewHsWeightSourceTarget(preview, target, field.value);
    assert.equal(api.hsWeightHasUnsavedChanges(reverted, saved, saved), false);
  }
});

function nsFixture() {
  const text = readFileSync(new URL(chartPath, import.meta.url), 'utf8');
  const names = [...text.matchAll(/^const (NS_\w+_PATH) =/gm)].map(match => match[1]);
  const paths = loadSelected(chartPath, names);
  const groups = new Map(), fields = [], lines = [];
  for (const name of names) {
    const path = paths[name];
    let values = [name.includes('Y1') ? 1024 : name.includes('X1') || name.includes('BRIGHTEST') ? 10
      : name.includes('LIMIT') ? 1000 : name.includes('DARK_Y') ? 100
      : name.includes('FLAT_THD') ? 80 : name.includes('NS_PCNT') ? 20 : name.includes('LOWBND_THD') ? 40 : 0];
    if (name === 'NS_NORT_BV_PATH') values = [0, 10];
    if (name === 'NS_NORT_THD_PATH') values = [40, 80];
    if (name === 'NS_BT_THD_PATH') values = [60, 100];
    if (name === 'NS_NORT_NS_EN_PATH') values = [25, 75];
    const line = lines.length + 1;
    const entries = values.map((value, index) => ({
      path: values.length > 1 ? `${path}.${index}` : path,
      value: String(value), line, index: fields.length + index,
      column_start: values.slice(0, index).join(', ').length + (index ? 3 : 1),
      column_end: values.slice(0, index).join(', ').length + (index ? 3 : 1) + String(value).length,
    }));
    groups.set(path, entries); fields.push(...entries); lines.push(values.join(', ') + ',');
  }
  return { groups, fields, draft: lines.join('\n') };
}

test('NS save covers probability curves and both area tables, including focused previews', async () => {
  const fixture = nsFixture();
  const api = loadSelected(chartPath, [
    'loadNsProbabilityCurveSource', 'loadNsNorTSource', 'loadNsBTSource', 'nsTableHasUnsavedChanges',
    'previewNsProbabilitySourceTarget', 'previewNsNorTSourceTarget',
    'getNsProbabilityTargetField', 'getNsNorTTargetField',
    'replaceNsProbabilityCellInSourceText', 'replaceNsNorTCellInSourceText',
    'updateNsProbabilitySourceField', 'updateNsNorTSourceTarget',
  ], { cppGetFieldsAtPath: async (_, path) => fixture.groups.get(path) ?? [] });
  const probability = await api.loadNsProbabilityCurveSource('AE.cpp');
  const normalArea = await api.loadNsNorTSource('AE.cpp');
  const btArea = await api.loadNsBTSource('AE.cpp');
  const saved = fixture.draft;
  const curveTargets = ['bv', 'cdf'].flatMap(curveId => ['x0', 'x1', 'y0', 'y1'].map(fieldId => ({ curveId, fieldId })));
  const areaTargets = source => [
    ...['bv', 'thd'].flatMap(row => source.bvValues.map((_, index) => ({ kind: 'thdTable', row, index }))),
    ...['interval', 'pcnt'].flatMap(row => source.nsEvdDefineFields.map((_, index) => ({ kind: 'evdDefine', row, index }))),
    ...Object.entries(source.flatSettings).filter(([, setting]) => setting.field).map(([id]) => ({ kind: 'flatSetting', id })),
    ...['x0', 'x1', 'y0', 'y1'].map(fieldId => ({ kind: 'flatProb', fieldId })),
  ];
  for (const [source, targets, preview, getField, replace, update] of [
    [probability, curveTargets, api.previewNsProbabilitySourceTarget, api.getNsProbabilityTargetField, api.replaceNsProbabilityCellInSourceText,
      (src, target, field, value) => api.updateNsProbabilitySourceField(src, field, value)],
    ...[normalArea, btArea].map(source => [source, areaTargets(source), api.previewNsNorTSourceTarget,
      api.getNsNorTTargetField, api.replaceNsNorTCellInSourceText, api.updateNsNorTSourceTarget]),
  ]) {
    assert.equal(api.nsTableHasUnsavedChanges(source, saved, saved), false);
    assert.equal(api.nsTableHasUnsavedChanges(source, saved + '\n// unrelated', saved), false);
    for (const target of targets) {
      const field = getField(source, target);
      assert.ok(field);
      const value = String(Number(field.value) + 1);
      const pending = preview(source, target, value);
      assert.equal(api.nsTableHasUnsavedChanges(pending, saved, saved), true, JSON.stringify(target));
      const committed = replace(saved, source, field, value);
      assert.ok(committed, `must locate every editable source token: ${JSON.stringify(target)}`);
      assert.equal(api.nsTableHasUnsavedChanges(source, committed, saved), true);
      const current = update(pending, target, field, value);
      assert.equal(api.nsTableHasUnsavedChanges(current, committed, committed), false, 'saving clears all preview metadata');
      assert.equal(api.nsTableHasUnsavedChanges(preview(source, target, field.value), saved, saved), false);
    }
  }
  const secondDefine = normalArea.nsEvdDefineFields[1];
  assert.ok(normalArea.fields.some(field => field.path === secondDefine.path), 'NorT must retain the second same-line percentage field');
  const updated = api.replaceNsNorTCellInSourceText(saved, normalArea, secondDefine, '90');
  assert.equal(updated.split('\n')[secondDefine.line - 1], '25, 90,', 'editing the second percentage must preserve the first token');
  assert.equal(api.nsTableHasUnsavedChanges(null, saved, saved), false);
  assert.equal(api.nsTableHasUnsavedChanges(normalArea, saved, null), false);
  const uniqueThd = api.replaceNsNorTCellInSourceText(saved, normalArea, normalArea.thdFields[0], '99');
  assert.equal(api.nsTableHasUnsavedChanges(btArea, uniqueThd, saved), false, 'NorT-only THD does not dirty BT');
  const sharedBv = api.replaceNsNorTCellInSourceText(saved, normalArea, normalArea.bvFields[0], '2');
  assert.equal(api.nsTableHasUnsavedChanges(normalArea, sharedBv, saved), true);
  assert.equal(api.nsTableHasUnsavedChanges(btArea, sharedBv, saved), true, 'the shared BV axis belongs to both cards');
});

test('NS background parse updates preserve the current input preview and clear it on source removal', async () => {
  const fixture = nsFixture();
  const api = loadSelected(chartPath, [
    'loadNsProbabilityCurveSource', 'loadNsNorTSource', 'previewNsProbabilitySourceTarget', 'previewNsNorTSourceTarget',
  ], { cppGetFieldsAtPath: async (_, path) => fixture.groups.get(path) ?? [] });
  const parsed = ts.createSourceFile(chartPath, readFileSync(new URL(chartPath, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const syncSource = (name, globals) => {
    const declaration = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    let callback;
    const visit = node => {
      if (ts.isCallExpression(node) && node.expression.getText(parsed) === 'useEffect'
        && node.arguments[0]?.getText(parsed).includes('const preview = cellPreviewRef.current')) callback = node.arguments[0];
      ts.forEachChild(node, visit);
    };
    visit(declaration);
    assert.ok(callback, name);
    const code = ts.transpileModule(`return (${callback.getText(parsed)})();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    return new Function(...Object.keys(globals), code)(...Object.values(globals));
  };
  for (const [name, source, target, readValue] of [
    ['NsProbabilityCard', await api.loadNsProbabilityCurveSource('AE.cpp'), { curveId: 'cdf', fieldId: 'y1' }, source => source.cdf.y1],
    ['NsNorTAreaCard', await api.loadNsNorTSource('AE.cpp'), { kind: 'flatSetting', id: 'nsPcnt' }, source => source.flatSettings.nsPcnt.value],
  ]) {
    let current;
    const ref = { current: { target, value: '257' } };
    const apply = source => syncSource(name, { source, cellPreviewRef: ref,
      setEditableSource: next => { current = next; }, ...api });
    apply({ ...source }); // Previous save's parser result arrives during the next edit.
    assert.equal(readValue(current), 257);
    assert.notEqual(readValue(source), 257, 'loaded source remains immutable');
    ref.current = null;
    apply(source);
    assert.equal(current, source, 'committed or cancelled input no longer overlays new parser data');
    ref.current = { target, value: '258' };
    apply(null);
    assert.equal(current, null);
    assert.equal(ref.current, null, 'a different/removed source cannot inherit the old preview');
  }
});

test('Normal formula comparison retains six parameter paths and both EXIF aggregate sources', () => {
  const { NormalTargetFormula } = loadSelected('../src/views/mtk/isp6s/ImagePane/DerivedTargetFormula.tsx', ['NormalTargetFormula'], {
    useTranslation: () => ({ t }), DerivedTargetFormula: 'DerivedTargetFormula',
  });
  const exif = normal.calculateNormalTargetFormula(normal.readNormalTargetFormulaSource(normalExifData));
  const parameter = normal.calculateParameterNormalTargetFormula({ mainTarget: 100, mainWeight: 435, hsTargets: [130, 230, 330], hsWeights: [335, 235, 135], nsTarget: 400, nsProb: 512 });
  const tree = NormalTargetFormula({ exif, parameter });
  for (const tone of ['BT', 'MT', 'DT']) for (const suffix of ['Tar', 'Wt']) {
    const row = tree.props.sources.find(entry => entry.name === `HS_${tone}_${suffix}`);
    assert.ok(Number.isFinite(row.parameter.value));
    assert.match(row.parameter.source, /interp/);
  }
  assert.equal(tree.props.sources.find(entry => entry.name === 'HS_Tar').exif.source, 'EXIF · AE_TAG_HSV6_HS_TARGET');
  assert.equal(tree.props.sources.find(entry => entry.name === 'HS_Wt').exif.source, 'EXIF · AE_TAG_HSV6_HS_WET');
  const { FACE_LINK_TARGET_IMAGE_KEYS } = loadSelected('../src/views/mtk/isp6s/TablePane/TablePane.tsx', ['FACE_LINK_TARGET_IMAGE_KEYS']);
  for (const key of ['AE_TAG_HSV6_HS_TARGET', 'AE_TAG_HSV6_HS_WET', normal.MAIN_TARGET_CWV_KEY]) assert.ok(FACE_LINK_TARGET_IMAGE_KEYS.includes(key), key);
});

// Execute the actual FaceTabContent declarations before evaluating its JSX props.
// This catches a caller wired to the recorded Normal value despite correct helpers.
function faceTabNormalBindings(metricInputs) {
  const parsed = ts.createSourceFile(chartPath, readFileSync(new URL(chartPath, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'FaceTabContent');
  assert.ok(component?.body);
  const names = new Set(['normalFormula', 'parameterNormalFormula', 'exifNormalTarget', 'parameterNormalTarget']);
  const statements = component.body.statements.filter(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name)
      ? names.has(declaration.name.text)
      : declaration.name.elements.some(element => element.name?.getText(parsed) === 'rawBackSceneTarget')));
  assert.equal(statements.length, 5);
  const exports = statements.flatMap(statement => statement.declarationList.declarations.flatMap(declaration =>
    ts.isIdentifier(declaration.name) ? [declaration.name.text] : declaration.name.elements.map(element => element.name.getText(parsed))));
  const globals = {
    ...normal, ...chart, ...loadSelected(chartPath, ['parseFiniteNumber']), ...metricInputs,
    currentSource: source,
    normalTargetSource: normal.readNormalTargetFormulaSource({
      AE_TAG_MTV6_MAINT_TARGET: '814', AE_TAG_HSV6_MAINT_WET: '1024', AE_TAG_HSV6_HS_WET: '0', AE_TAG_NS_PROB: '0',
    }),
    normalTargetParameterValues: { mainTarget: 809, mainWeight: 1024, hsTargets: [NaN, NaN, NaN], hsWeights: [0, 0, 0], nsTarget: NaN, nsProb: 0 },
    faceStsSizeValue: String(metricInputs.faceStsSize), faceStsLocValue: String(metricInputs.faceStsLoc),
    fddrValue: String(metricInputs.fddr), fdszValue: String(metricInputs.fdsz), fdszRaValue: String(metricInputs.exifFdszRa),
  };
  const code = statements.map(statement => statement.getText(parsed)).join('\n') + `\nmodule.exports = { ${exports.join(', ')} };`;
  const { outputText } = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const module = { exports: {} };
  for (const name of exports) delete globals[name];
  new Function('module', ...Object.keys(globals), outputText)(module, ...Object.values(globals));
  return module.exports;
}

test('Back Scene caller, summary and derivation use Normal 814 from EXIF and 809 from parameters', () => {
  const bindings = faceTabNormalBindings({ ...inputs, fltMode: false });
  assert.equal(bindings.exifNormalTarget, 814);
  assert.equal(bindings.parameterNormalTarget, 809);
  close(bindings.rawExifBackSceneTarget, (1000 * 512 + 814 * 512) / 1024);
  close(bindings.rawBackSceneTarget, (1000 * 512 + 809 * 512) / 1024);
  const props = chartFormulaProps(bindings, 'BackSceneTargetFormula');
  const { BackSceneTargetFormula } = loadSelected('../src/views/mtk/isp6s/ImagePane/DerivedTargetFormula.tsx', ['BackSceneTargetFormula'], {
    useTranslation: () => ({ t }), DerivedTargetFormula: 'DerivedTargetFormula',
  });
  const tree = BackSceneTargetFormula(props);
  const [exifRow, parameterRow] = tree.props.rows;
  assert.equal(exifRow.values[2], 814);
  assert.equal(parameterRow.values[2], 809);
  assert.match(exifRow.steps[0].substitution, /814\.0/);
  assert.match(parameterRow.steps[0].substitution, /809\.0/);
  const entry = tree.props.sources.find(entry => entry.name === 'Normal_Target');
  assert.match(entry.exif.source, /Cal_final_tar\(EXIF\)/);
  assert.match(entry.parameter.source, /Cal_final_tar\(AE.cpp\)/);
});

test('Face Link caller uses separate Normal results in raw, clamp and source details', () => {
  const bindings = faceTabNormalBindings(inputs);
  const props = chartFormulaProps(bindings);
  assert.equal(props.exif.normalTarget, bindings.normalFormula.finalTarget);
  assert.equal(props.parameter.normalTarget, bindings.parameterNormalFormula.finalTarget);
  close(props.exif.rawTarget, (1000 + 814) / 2);
  close(props.parameter.rawTarget, (1000 + 809) / 2);
  assert.equal(props.exif.result, 600, 'existing EXIF clamp still applies after mixing');
  assert.equal(props.parameter.result, 500, 'existing parameter clamp still applies after mixing');
  const tree = FaceLinkFormula(props);
  const entry = nodesOfType(tree, 'FormulaHeader')[0].props.sources.find(entry => entry.name === 'Normal_Target');
  assert.equal(entry.exif.value, 814);
  assert.equal(entry.parameter.value, 809);
  assert.match(entry.exif.source, /Cal_final_tar\(EXIF\)/);
  assert.match(entry.parameter.source, /Cal_final_tar\(AE.cpp\)/);
  assert.match(visibleText(formulaCards(tree)[0]), /814\.0/);
  assert.match(visibleText(formulaCards(tree)[1]), /809\.0/);
});

for (const fltMode of [false, true]) {
  test(`${fltMode ? 'Face Link' : 'Back Scene'} Normal inputs stay independent and missing parameters never borrow EXIF`, () => {
    const wide = { ...source, cwrBounds: { low: 0, high: 5000 } };
    const data = { ...inputs, fltMode, exifNormalTarget: 814, parameterNormalTarget: 809 };
    const baseline = chart.calculateFaceTargetMetrics(wide, data);
    const changed = chart.calculateFaceTargetMetrics(wide, { ...data, parameterNormalTarget: 700 });
    assert.equal(changed.exifBackSceneTarget, baseline.exifBackSceneTarget);
    close(changed.backSceneTarget - baseline.backSceneTarget, (700 - 809) / 2);
    const unavailable = chart.calculateFaceTargetMetrics(wide, { ...data, parameterNormalTarget: NaN });
    assert.ok(Number.isNaN(unavailable.rawBackSceneTarget));
    assert.ok(Number.isNaN(unavailable.backSceneTarget));
    assert.equal(unavailable.exifBackSceneTarget, baseline.exifBackSceneTarget);
    const noExif = chart.calculateFaceTargetMetrics(wide, { ...data, exifNormalTarget: NaN });
    assert.ok(Number.isNaN(noExif.exifBackSceneTarget));
    assert.equal(noExif.backSceneTarget, baseline.backSceneTarget);
  });
}

test('applied HS edits propagate through Normal_new to BackTar_new/FLinkTar_new in the directory calculator', async () => {
  const data = {
    ...fixtureData,
    AE_TAG_FACE_20_NORMAL_TARGET: '9999', // Recorded legacy scalar must not short-circuit the Normal card.
    AE_TAG_FBT_DR: '0', AE_TAG_FLT_DR: '0', AE_TAG_FBT_FDY: '1024', AE_TAG_FLT_FDY: '1024',
    AE_TAG_FBT_OE_SYS: '1024', AE_TAG_FLT_OE_SYS: '1024', AE_TAG_FBT_FDDR: '0', AE_TAG_FLT_FDDR: '0', AE_TAG_FLT_FDSZ: '0',
    AE_TAG_FBT_TARGET: '1024', AE_TAG_FLT_TARGET: '1024', AE_TAG_FACE_PROB: '512', AE_TAG_FLT_FDSZ_RA: '512',
    AE_TAG_FACE_STS_SIZE: '0', AE_TAG_FACE_STS_LOC: '0', AE_TAG_AE_TARGET: '1024',
    AE_TAG_FACE_LOW_BOUND: '0', AE_TAG_FACE_HIGH_BOUND: '5000',
  };
  const before = (await hsPipeline.loadFaceLinkTargetCalculator('base'))(data, 'AE_TAG_REALBVX1000');
  const after = (await hsPipeline.loadFaceLinkTargetCalculator('bright'))(data, 'AE_TAG_REALBVX1000');
  assert.notEqual(before.normal.calculated, after.normal.calculated);
  for (const result of [before, after]) {
    const faceTarget = Number(data[normal.MAIN_TARGET_CWV_KEY]);
    close(result.backScene.exif, (faceTarget + result.normal.exif) / 2);
    close(result.backScene.calculated, (faceTarget + result.normal.calculated) / 2);
    close(result.faceLink.exif, result.backScene.exif);
    close(result.faceLink.calculated, result.backScene.calculated);
  }
  assert.equal(before.backScene.exif, after.backScene.exif);
  assert.equal(before.faceLink.exif, after.faceLink.exif);
  close(after.backScene.calculated - before.backScene.calculated, (after.normal.calculated - before.normal.calculated) / 2);
  close(after.faceLink.calculated - before.faceLink.calculated, (after.normal.calculated - before.normal.calculated) / 2);
  const metrics = loadSelected('../src/views/mtk/isp6s/TablePane/imageTableMetrics.ts', ['deltaEv', 'formatDeltaEv']);
  const { imageFaceTargetValues, imageTableFormulaAlias } = loadSelected('../src/views/mtk/isp6s/TablePane/TablePane.tsx', ['imageFaceTargetValues', 'imageTableFormulaAlias'], metrics);
  for (const [key, pair] of [['Normal', 'normal'], ['BackTar', 'backScene'], ['FLinkTar', 'faceLink']]) {
    const values = imageFaceTargetValues(after);
    assert.equal(imageTableFormulaAlias(`${key}_old`, values, false), String(Math.round(after[pair].exif)));
    assert.equal(imageTableFormulaAlias(`${key}_new`, values, false), String(Math.round(after[pair].calculated)));
  }
});
