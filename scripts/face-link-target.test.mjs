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
  nsProb: 0, normalTarget: 100, aeTarget: 1024, oeSys: 1024, fddr: 0, fdsz: 0,
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
  const metrics = chart.calculateFaceTargetMetrics({ ...source, cwrBounds: { low: 90, high: 91 } }, { ...inputs, aeTarget: 752, normalTarget: 521 });
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
  data[chart.FACE_NORMAL_TARGET_KEY] = '100';
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

function chartFormulaProps(extra = {}) {
  // Evaluate the actual callsite props too, so row order and jump callbacks
  // cannot drift from FaceTabContent while the standalone summary still passes.
  const parsed = ts.createSourceFile(chartPath, readFileSync(new URL(chartPath, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let invocation;
  const visit = node => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsed) === 'FaceLinkFormula') invocation = node;
    ts.forEachChild(node, visit);
  };
  visit(parsed); assert.ok(invocation);
  const globals = {
    ...chart.calculateFaceTargetMetrics(source, inputs),
    ...loadSelected(chartPath, ['FACE_CWR_LOW_BOUND_KEY', 'FACE_CWR_HIGH_BOUND_KEY', 'FACE_CWR_LOW_BOUND_PATH', 'FACE_CWR_HIGH_BOUND_PATH', 'FACE_FLT_FDSZ_RA_KEY', 'FACE_FLT_FDSZ_SOURCE']),
    FaceLinkFormula: 'FaceLinkFormula', aeTarget: inputs.aeTarget, normalTarget: inputs.normalTarget,
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
