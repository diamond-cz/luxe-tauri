import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

// Execute production TypeScript/JSX without loading unrelated Tauri UI modules.
function load(relative, globals = {}, onlyFunction) {
  const path = new URL(relative, import.meta.url);
  const text = readFileSync(path, 'utf8');
  const parsed = ts.createSourceFile(relative, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const code = onlyFunction ? parsed.statements.filter(node => ts.isFunctionDeclaration(node)
    && node.name?.text === onlyFunction).map(node => node.getText(parsed)).join('\n')
    + `\nmodule.exports = { ${onlyFunction} };` : text;
  const { outputText } = ts.transpileModule(code, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } });
  const module = { exports: {} };
  const jsx = (type, props) => ({ type, props });
  new Function('require', 'module', 'exports', ...Object.keys(globals), outputText)(id => {
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (id === 'react-i18next') return { useTranslation: () => ({ t }) };
    if (id === 'react') return { useState: initial => [initial, () => {}] };
    if (id === './toneLceCurveModel') return curveModel;
    throw new Error(`Unexpected import: ${id}`);
  }, module, module.exports, ...Object.values(globals));
  return module.exports;
}
const locales = ['zh_CN', 'zh_TW', 'en_US', 'ja_JP', 'tr_TR'];
const bundles = locales.map(locale => JSON.parse(readFileSync(new URL(`../src-tauri/resources/translations/${locale}.json`, import.meta.url), 'utf8')));
const t = (key, args = {}) => bundles[0][key].replace(/\{\{(\w+)\}\}/g, (_, name) => String(args[name] ?? ''));
const { calculateLceTarget, lceTargetWeights } = load('../src/views/mtk/isp6s/ImagePane/toneLceTarget.ts');
const curveModel = load('../src/views/mtk/isp6s/ImagePane/toneLceCurveModel.ts');
const { ToneLceCurve } = load('../src/views/mtk/isp6s/ImagePane/ToneLceCurve.tsx');
const { ToneLceTargetWeight } = load('../src/views/mtk/isp6s/ImagePane/ToneLceTargetWeight.tsx');
const text = node => node == null ? '' : Array.isArray(node) ? node.map(text).join('')
  : typeof node === 'object' ? text(node.props.children) : String(node);
const nodes = (node, type) => node == null || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(n => nodes(n, type))
  : [...(node.type === type ? [node] : []), ...nodes(node.props.children, type)];
const fixture = {
  SW_LCE_LumaTarget: '2282', SW_LCE_FlatTarget: '523', SW_LCE_LumaProb: '1000', SW_LCE_FlatProb: '253',
  SW_LCE_LumaFlatProb: '253', SW_LCE_LumaFlatTarget: '1774', SW_LCE_LVTarget: '2048', SW_LCE_LVProb: '715',
};

test('raw LumaProb and LumaTarget feed a normalized chain, independently of recorded intermediate values', () => {
  const result = calculateLceTarget(fixture, 2000);
  assert.equal(result.lumaProb, 1000);
  assert.equal(result.lumaTarget, 2282);
  assert.equal(result.lumaFlatProb, 253, 'must not multiply 253 by 253 again');
  assert.equal(result.lumaFlatTarget, 1836.973, 'normalization must divide the blend by 1000');
  assert.equal(result.finalTarget, 1988, 'final blend must consume the recalculated target');
  assert.equal(result.parameterFinalTarget, 1954);
  assert.equal(result.recordedLumaFlatTarget, 1774, 'recorded mismatch remains observable');
  const changed = calculateLceTarget({ ...fixture, SW_LCE_LumaFlatTarget: '9999', SW_LCE_LumaFlatProb: '999', SW_LCE_FinalTarget: '42' }, 2000);
  assert.equal(changed.lumaFlatProb, result.lumaFlatProb);
  assert.equal(changed.lumaFlatTarget, result.lumaFlatTarget);
  assert.equal(changed.finalTarget, result.finalTarget);
  assert.equal(changed.recordedFinalTarget, 42);
  assert.equal(fixture.SW_LCE_LumaTarget, '2282');
});

test('changing each raw input affects its downstream results', () => {
  const baseline = calculateLceTarget(fixture, 2000);
  const changedProb = calculateLceTarget({ ...fixture, SW_LCE_LumaProb: '500' }, 2000);
  assert.equal(changedProb.lumaFlatProb, 127, 'retain existing Math.round probability convention');
  assert.notEqual(changedProb.finalTarget, baseline.finalTarget);
  assert.notEqual(calculateLceTarget({ ...fixture, SW_LCE_LumaTarget: '1500' }, 2000).finalTarget, baseline.finalTarget);
});

test('missing raw inputs cannot fall back to recorded intermediates; lowercase and zero are supported', () => {
  for (const key of ['SW_LCE_LumaProb', 'SW_LCE_LumaTarget', 'SW_LCE_FlatProb', 'SW_LCE_FlatTarget', 'SW_LCE_LVTarget', 'SW_LCE_LVProb']) {
    for (const missing of [undefined, '', '-', 'NaN', 'Infinity']) {
      assert.ok(Number.isNaN(calculateLceTarget({ ...fixture, [key]: missing }, 2000).finalTarget), `${key}: ${missing}`);
    }
  }
  const lower = Object.fromEntries(Object.entries(fixture).map(([key, value]) => [key.toLowerCase(), value]));
  assert.equal(calculateLceTarget(lower, 2000).finalTarget, 1988);
  const zeros = Object.fromEntries(Object.keys(fixture).map(key => [key, '0']));
  assert.equal(calculateLceTarget(zeros, 0).finalTarget, 0);
  assert.ok(Number.isNaN(calculateLceTarget({ ...fixture, SW_LCE_LumaProb: '1001' }, 2000).finalTarget));
});

test('weights match the reference LV, Luma and Flat proportions and always sum to one', () => {
  const weights = calculateLceTarget(fixture, 2000).weights;
  assert.deepEqual(Object.values(weights).map(value => (value * 100).toFixed(1)), ['71.5', '21.3', '7.2']);
  for (const lv of [0, 1, 500, 715, 1000]) for (const flat of [0, 1, 253, 500, 1000]) {
    const w = lceTargetWeights(lv, flat);
    assert.ok(Math.abs(w.lv + w.luma + w.flat - 1) < 1e-12);
    assert.ok(Object.values(w).every(value => value >= 0 && value <= 1));
  }
  assert.deepEqual(lceTargetWeights(1000, 253), { lv: 1, luma: 0, flat: 0 });
  assert.deepEqual(lceTargetWeights(0, 1000), { lv: 0, luma: 0, flat: 1 });
  for (const invalid of [NaN, Infinity, -1, 1001]) {
    assert.equal(lceTargetWeights(invalid, 253), null);
    assert.equal(lceTargetWeights(715, invalid), null);
  }
});

test('chart uses recorded probability rather than silently substituting recomputed probability', () => {
  const result = calculateLceTarget({ ...fixture, SW_LCE_LumaFlatProb: '500' }, 2000);
  assert.equal(result.lumaFlatProb, 253);
  assert.equal(result.weights.flat, (1 - .715) * .5);
  assert.equal(calculateLceTarget({ ...fixture, SW_LCE_LumaFlatProb: undefined }, 2000).weights, null);
});

test('ring renders the four EXIF keys, three proportions and semantic colors; missing data has no fake slices', () => {
  const tree = ToneLceTargetWeight({ calculation: calculateLceTarget(fixture, 2000) });
  for (const key of ['SW_LCE_LumaProb', 'SW_LCE_FlatProb', 'SW_LCE_LumaFlatProb', 'SW_LCE_LVProb']) assert.ok(text(tree).includes(key));
  for (const percent of ['71.5%', '21.3%', '7.2%']) assert.ok(text(tree).includes(percent));
  const circles = nodes(tree, 'circle').filter(node => node.props.pathLength === '100');
  assert.equal(circles.length, 3);
  assert.ok(circles.every(node => node.props.stroke.startsWith('var(--colorPalette')));
  assert.match(nodes(tree, 'svg')[0].props['aria-label'], /LV 71.5%, Luma 21.3%, Flat 7.2%/);
  assert.deepEqual(nodes(nodes(tree, 'table')[0], 'th').map(node => text(node)), [
    'SW_LCE_LVProb', 'SW_LCE_LumaFlatProb', 'SW_LCE_LumaProb', 'SW_LCE_FlatProb',
  ]);
  assert.equal(nodes(tree, 'tr').length, 4, 'weight footer has four rows matching the curve footer');
  assert.equal(nodes(tree, 'polyline').length, 3, 'each weight has an outside leader label');
  for (const [lv, flat] of [[0, 680], [1000, 0], [0, 1000], [1, 999]]) {
    const sample = ToneLceTargetWeight({ calculation: calculateLceTarget({ ...fixture, SW_LCE_LVProb: String(lv), SW_LCE_LumaFlatProb: String(flat) }, 2000) });
    assert.equal(nodes(sample, 'text').length, 3, 'zero weights keep their labels without a fake wedge');
    for (const rect of nodes(sample, 'rect')) {
      assert.ok(rect.props.y >= 0 && rect.props.y + Number(rect.props.height) <= 230, 'labels stay inside the SVG');
    }
    const rects = nodes(sample, 'rect');
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      if (rects[i].props.x === rects[j].props.x) assert.ok(Math.abs(rects[i].props.y - rects[j].props.y) >= 24, 'same-side labels do not overlap');
    }
  }
  const missing = ToneLceTargetWeight({ calculation: calculateLceTarget({}, NaN) });
  assert.equal(nodes(missing, 'circle').filter(node => node.props.pathLength === '100').length, 0);
  assert.equal(nodes(missing, 'p').find(node => node.props.role === 'status').props.children, t('tone_lce.invalid_weights'));
});

test('calculation card shows the connected formulas and recorded comparisons', () => {
  const { ToneLceCalCard } = load('../src/views/mtk/isp6s/ImagePane/ToneChartMapMode.tsx', {
    useTranslation: () => ({ t }), formatInterpolation: value => Number.isFinite(value) ? String(Number(value.toFixed(2))) : '-',
    lceCardStyle: {}, lceHeaderStyle: {},
  }, 'ToneLceCalCard');
  const tree = ToneLceCalCard({ calculation: calculateLceTarget({ ...fixture, SW_LCE_FinalTarget: '1970' }, 2000) });
  const visible = text(tree);
  assert.ok(visible.indexOf('LumaFlatProb =') < visible.indexOf('LumaFlatTarget ='));
  assert.ok(visible.indexOf('LumaFlatTarget =') < visible.indexOf('FinalTarget ='));
  assert.ok(visible.includes('(1000 * 253) / 1000 = 253'));
  assert.ok(visible.includes('(523 * 253 + 2282 * (1000 - 253)) / 1000 = 1836.97'));
  assert.ok(visible.includes('(2048 * 715 + 1836.97 * (1000 - 715)) / 1000 = 1988'));
  for (const key of ['SW_LCE_LumaFlatProb', 'SW_LCE_LumaFlatTarget', 'SW_LCE_FinalTarget']) assert.ok(visible.includes(key));
});

test('all five locales provide complete calculation and chart text with matching placeholders', () => {
  const shape = bundles.map(bundle => Object.entries(bundle).filter(([key]) => key.startsWith('tone_lce.')).map(([key, value]) => {
    assert.doesNotMatch(value, /\?/, 'translations must not contain encoding replacements');
    return [key, [...value.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]).sort()];
  }).sort());
  assert.equal(shape[0].length, 11);
  shape.slice(1).forEach(value => assert.deepEqual(value, shape[0]));
});

const curveInput = () => {
  const input = { SW_LCE_FaceLoBound: '523', SW_LCE_FaceHiBound: '1910' };
  const p = [0, 2279, 2426, 2510, 2784, 3360, 3576, 3699];
  const o = [0, 2437, 2582, 2667, 2943, 3519, 3591, 3699];
  curveModel.LCE_CURVE_PIVOTS.forEach((suffix, index) => {
    input[`SW_LCE_P${suffix}`] = String(p[index]);
    input[`SW_LCE_O${suffix}`] = String(o[index]);
  });
  return input;
};

test('recorded curve pairs actual P with O, reproduces reference Gain and log face bounds', () => {
  const model = curveModel.buildLceCurve(curveInput());
  assert.equal(model.outputPrefix, 'SW_LCE_O');
  assert.deepEqual(model.nodes.map(node => node.gain), [0, 158, 156, 157, 159, 159, 15, 0]);
  assert.deepEqual(model.nodes.slice(1, 3).map(node => node.p), [2279, 2426], 'percentile suffix is not a chart coordinate');
  assert.deepEqual(model.bounds.map(bound => bound.log), [2784, 3360]);
  assert.equal(model.segments.length, 1);
  assert.equal(model.segments[0].length, 8);
  assert.equal(curveModel.lceLinearBoundToLog(0), 0);
  assert.ok(Number.isNaN(curveModel.lceLinearBoundToLog(-1)));
});

test('final GCE outputs apply documented packed-value modulo and never mix missing nodes with raw O', () => {
  const input = { ...curveInput(), SW_LCE_GCEO1: '12437' };
  const model = curveModel.buildLceCurve(input);
  assert.equal(model.outputPrefix, 'SW_LCE_GCEO');
  assert.equal(model.nodes[1].o, 2437);
  assert.equal(model.nodes[1].oKey, 'SW_LCE_GCEO1');
  assert.ok(Number.isNaN(model.nodes[2].o));
  assert.equal(model.nodes[2].valid, false);
  const lower = Object.fromEntries(Object.entries(curveInput()).map(([key, value]) => [key.toLowerCase(), value]));
  assert.deepEqual(curveModel.buildLceCurve(lower).nodes.map(node => node.gain), [0, 158, 156, 157, 159, 159, 15, 0]);
});

test('curve gaps, out-of-order pivots and invalid coordinates cannot create a fabricated connecting line', () => {
  const input = { ...curveInput(), SW_LCE_P250: '-', SW_LCE_O750: '5000' };
  const model = curveModel.buildLceCurve(input);
  assert.deepEqual(model.segments.map(segment => segment.map(node => node.index)), [[0, 1, 2], [4], [6, 7]]);
  const reversed = curveModel.buildLceCurve({ ...curveInput(), SW_LCE_P250: '2000' });
  assert.equal(reversed.segments.length, 2);
  assert.equal(curveModel.buildLceCurve({}).available, false);
});

test('curve JSX renders P/O coordinates, identity line, log face bounds and all eight table columns', () => {
  const tree = ToneLceCurve({ tomlData: curveInput() });
  assert.equal(tree.props['aria-label'], 'LCE Curve');
  assert.equal(nodes(tree, 'div').find(node => node.props.className === 'tone-lce-chart-header').props.children.type, 'strong', 'title contains no EXIF source suffix');
  assert.equal(nodes(tree, 'circle').length, 8);
  assert.equal(nodes(tree, 'polyline').length, 1);
  const legend = nodes(tree, 'g').find(node => node.props['aria-label'] === t('tone_lce.curve_legend'));
  assert.ok(legend, 'legend is inside the SVG plot');
  assert.equal(nodes(legend, 'text').length, 3);
  const axisNames = nodes(tree, 'text');
  const pAxis = axisNames.find(node => node.props.children === 'P');
  const oAxis = axisNames.find(node => node.props.children === 'O');
  assert.ok(pAxis.props.x > 596 && pAxis.props.y >= 347, 'P sits at the bottom-right axis end');
  assert.ok(oAxis.props.x === 42 && oAxis.props.y < 23, 'O sits above the vertical axis');
  assert.equal(nodes(tree, 'line').filter(node => node.props.children?.type === 'title').length, 2);
  const rows = nodes(tree, 'tr');
  assert.equal(rows.length, 4);
  assert.ok(nodes(rows[2], 'td').every(node => node.props.title.startsWith('SW_LCE_O')), 'actual output source remains accessible on data cells');
  assert.equal(nodes(rows[0], 'th').length, 9);
  assert.deepEqual(nodes(rows[3], 'td').map(node => text(node)), ['0', '158', '156', '157', '159', '159', '15', '0']);
  const missing = ToneLceCurve({ tomlData: {} });
  assert.equal(nodes(missing, 'polyline').length, 0);
  assert.equal(nodes(missing, 'circle').length, 0);
  assert.ok(text(missing).includes(t('tone_lce.curve_unavailable')));
});
