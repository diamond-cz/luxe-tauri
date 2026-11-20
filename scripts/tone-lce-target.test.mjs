import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

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
    if (id === 'react') return { useState: initial => [initial, () => {}], useId: () => 'formula-test-id', useRef: value => ({ current: value }), useEffect: () => {} };
    if (id === './toneLceCurveModel') return curveModel;
    if (id === '@/components/common/HoverTooltip') return { HoverTooltip: 'HoverTooltip' };
    if (id === './ToneLceChartHeader') return { ToneLceChartHeader: 'ToneLceChartHeader' };
    if (id === './FormulaHeader') return { FormulaHeader: 'FormulaHeader' };
    if (id === '@/stores/isp6sVisualStore') return { useIsp6sVisualStore: selector => selector(visualStore.getState()) };
    if (id === '@fluentui/react-components') return { Button: 'Button' };
    if (id === '@fluentui/react-icons') return { ChevronUp20Regular: 'ChevronUp', ChevronDown20Regular: 'ChevronDown' };
    if (id === 'zustand' || id === 'zustand/middleware/immer') return require(id);
    throw new Error(`Unexpected import: ${id}`);
  }, module, module.exports, ...Object.values(globals));
  return module.exports;
}
const locales = ['zh_CN', 'zh_TW', 'en_US', 'ja_JP', 'tr_TR'];
const bundles = locales.map(locale => JSON.parse(readFileSync(new URL(`../src-tauri/resources/translations/${locale}.json`, import.meta.url), 'utf8')));
const t = (key, args = {}) => bundles[0][key].replace(/\{\{(\w+)\}\}/g, (_, name) => String(args[name] ?? ''));
const { calculateLceTarget, lceTargetWeights } = load('../src/views/mtk/isp6s/ImagePane/toneLceTarget.ts');
const curveModel = load('../src/views/mtk/isp6s/ImagePane/toneLceCurveModel.ts');
const { useIsp6sVisualStore: visualStore } = load('../src/stores/isp6sVisualStore.ts');
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
  assert.equal(nodes(tree, 'tr').length, 4, 'weight formula table has four data rows');
  assert.equal(nodes(tree, 'polyline').length, 3, 'each weight has an outside leader label');
  const tips = nodes(tree, 'HoverTooltip');
  assert.equal(tips.length, 6, 'arcs and percentage labels share the project tooltip');
  assert.equal(nodes(tree, 'title').length, 0, 'no native SVG tooltip can duplicate the custom preview');
  assert.ok(tips.every(node => node.props.svg && node.props.wrap));
  assert.ok(tips.some(node => node.props.content === 'LV: 71.5%\nLVProb / 1000'));
  assert.ok(tips.some(node => node.props.content.includes('Flat: 7.2%\n(1 − LVProb / 1000) × LumaFlatProb / 1000')));
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

test('calculation card shares Normal Target layout and compares EXIF against interpolated LVTarget', () => {
  const { DerivedTargetFormula } = load('../src/views/mtk/isp6s/ImagePane/DerivedTargetFormula.tsx');
  const { ToneLceCalCard } = load('../src/views/mtk/isp6s/ImagePane/ToneChartMapMode.tsx', {
    useTranslation: () => ({ t }), formatInterpolation: value => Number.isFinite(value) ? String(Number(value.toFixed(2))) : '-',
    lceCardStyle: {}, DerivedTargetFormula,
  }, 'ToneLceCalCard');
  const tree = ToneLceCalCard({ calculation: calculateLceTarget({ ...fixture, SW_LCE_FinalTarget: '1970' }, 2000) });
  const summary = DerivedTargetFormula(tree.props.children.props);
  const header = nodes(summary, 'FormulaHeader')[0].props;
  assert.deepEqual(header.formulas, [
    'LumaFlatProb = LumaProb × FlatProb / 1000',
    'LumaFlatTarget = (FlatTarget × LumaFlatProb + LumaTarget × (1000 − LumaFlatProb)) / 1000',
    'FinalTarget = (LVTarget × LVProb + LumaFlatTarget × (1000 − LVProb)) / 1000',
  ]);
  const rows = nodes(summary, 'tbody')[0].props.children;
  assert.deepEqual(rows.map(row => nodes(row, 'td').map(text)), [
    ['2048', '715', '1836.97', '1988'], ['2000', '715', '1836.97', '1954'],
  ]);
  assert.deepEqual(rows.map(row => text(nodes(row, 'th')[0])), ['EXIF', t('face_link_formula.parameter')]);
  const lv = header.sources.find(source => source.name === 'LVTarget');
  assert.equal(lv.exif.value, 2048);
  assert.equal(lv.exif.source, 'EXIF · SW_LCE_LVTarget');
  assert.equal(lv.parameter.value, 2000);
  assert.match(lv.parameter.source, /Tone\.cpp.*LVTarget.*\[0\]\[0\]\[0\]\[0\]\[3\]/);
  for (const source of header.sources.filter(source => source.name !== 'LVTarget')) {
    assert.deepEqual(source.parameter, source.exif, `${source.name} continues to use EXIF`);
    assert.equal(source.exif.source, `EXIF · SW_LCE_${source.name}`);
  }
  const details = text(header.details);
  assert.ok(details.includes('(1000 × 253) / 1000 = 253'));
  assert.ok(details.includes('(523 × 253 + 2282 × (1000 − 253)) / 1000 = 1836.97'));
  assert.ok(details.includes('(2048 × 715 + 1836.97 × (1000 − 715)) / 1000 = 1988'));
  assert.ok(details.includes('(2000 × 715 + 1836.97 × (1000 − 715)) / 1000 = 1954'));
  for (const key of ['SW_LCE_LumaFlatProb', 'SW_LCE_LumaFlatTarget', 'SW_LCE_FinalTarget']) assert.ok(details.includes(key));
  const missing = ToneLceCalCard({ calculation: calculateLceTarget(fixture, NaN) });
  const missingSummary = DerivedTargetFormula(missing.props.children.props);
  assert.deepEqual(nodes(nodes(missingSummary, 'tbody')[0].props.children[1], 'td').map(text), ['-', '715', '1836.97', '-']);
});

test('all five locales provide complete calculation and chart text with matching placeholders', () => {
  const shape = bundles.map(bundle => Object.entries(bundle).filter(([key]) => key.startsWith('tone_lce.')).map(([key, value]) => {
    assert.doesNotMatch(value, /\?/, 'translations must not contain encoding replacements');
    return [key, [...value.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]).sort()];
  }).sort());
  assert.equal(shape[0].length, 13);
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
  assert.equal(nodes(tree, 'ToneLceChartHeader')[0].props.title, 'LCE Curve', 'title contains no EXIF source suffix');
  assert.equal(nodes(tree, 'circle').length, 8);
  const tooltips = nodes(tree, 'HoverTooltip');
  assert.equal(tooltips.length, 8, 'one shared project tooltip per curve point');
  assert.ok(tooltips.every(node => node.props.svg && node.props.wrap));
  assert.equal(tooltips[1].props.content, 'SW_LCE_P1: 2279\nSW_LCE_O1: 2437\nGain (O − P): 158');
  assert.ok(nodes(tree, 'circle').every(node => !node.props.children && !node.props.title), 'curve points have no native title tooltip');
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

test('weight formula table pairs each recorded probability with its recorded EXIF target in four columns', () => {
  const input = { ...fixture, SW_LCE_LVProb: '887', SW_LCE_LVTarget: '2032', SW_LCE_LumaFlatProb: '643',
    SW_LCE_LumaFlatTarget: '1292', SW_LCE_LumaProb: '1000', SW_LCE_LumaTarget: '2109', SW_LCE_FlatProb: '643', SW_LCE_FlatTarget: '897' };
  const tree = ToneLceTargetWeight({ calculation: calculateLceTarget(input, 1800) });
  const rows = nodes(tree, 'tr');
  const cells = row => [text(nodes(row, 'th')[0]), ...nodes(row, 'td').map(text)];
  assert.deepEqual(rows.map(cells), [
    ['SW_LCE_LVProb', '887', '2032', 'SW_LCE_LVTarget'],
    ['SW_LCE_LumaFlatProb', '643', '1292', 'SW_LCE_LumaFlatTarget'],
    ['SW_LCE_LumaProb', '1000', '2109', 'SW_LCE_LumaTarget'],
    ['SW_LCE_FlatProb', '643', '897', 'SW_LCE_FlatTarget'],
  ]);
  assert.notEqual(calculateLceTarget(input, 1800).lumaFlatTarget, 1292, 'formula table deliberately shows recorded EXIF instead of recomputed blend');
  const missing = ToneLceTargetWeight({ calculation: calculateLceTarget({ ...input, SW_LCE_LumaFlatTarget: '-' }, NaN) });
  assert.equal(nodes(nodes(missing, 'tr')[1], 'td')[1].props.children, '-');
  const zeros = ToneLceTargetWeight({ calculation: calculateLceTarget({ ...input, SW_LCE_LVTarget: '0' }, NaN) });
  assert.equal(nodes(nodes(zeros, 'tr')[0], 'td')[1].props.children, '0');
});

test('chart headers expose independent formula-row toggles and place data before the plot', () => {
  const { ToneLceChartHeader } = load('../src/views/mtk/isp6s/ImagePane/ToneLceChartHeader.tsx');
  let toggled = false;
  for (const expanded of [true, false]) {
    const tree = ToneLceChartHeader({ title: 'LCE Curve', expanded, controls: 'curve-formula', onToggle: () => { toggled = true; } });
    const button = nodes(tree, 'Button')[0];
    assert.equal(button.props['aria-expanded'], expanded);
    assert.equal(button.props['aria-controls'], 'curve-formula');
    assert.equal(button.props['aria-label'], t(expanded ? 'tone_lce.hide_formula' : 'tone_lce.show_formula', { title: 'LCE Curve' }));
    button.props.onClick();
    assert.equal(toggled, true);
  }
  for (const tree of [ToneLceCurve({ tomlData: curveInput() }), ToneLceTargetWeight({ calculation: calculateLceTarget(fixture, 2000) })]) {
    const children = tree.props.children;
    assert.equal(children[0].type, 'ToneLceChartHeader');
    assert.equal(children[1].props.className, 'tone-lce-chart-formula formula-panel');
    assert.equal(children[1].props.hidden, false);
    assert.equal(children[1].props.children.type, 'table');
    assert.equal(children[2].props.className, 'tone-lce-chart-body');
    assert.equal(nodes(children[1], 'tr').length, 4);
  }
  // Render fresh component instances after each click, as on return from another page.
  const render = () => [ToneLceCurve({ tomlData: curveInput() }), ToneLceTargetWeight({ calculation: calculateLceTarget(fixture, 2000) })];
  const assertExpanded = expected => render().forEach((tree, index) => {
    assert.equal(tree.props.children[0].props.expanded, expected[index]);
    assert.equal(tree.props.children[1].props.hidden, !expected[index]);
  });
  const savedVisual = visualStore.getState().visual;
  render()[0].props.children[0].props.onToggle();
  assertExpanded([false, true]);
  render()[1].props.children[0].props.onToggle();
  assertExpanded([false, false]);
  // Updating saved layout preferences must not reset session visibility.
  visualStore.getState().setVisual(savedVisual);
  assertExpanded([false, false]);
  render()[0].props.children[0].props.onToggle();
  assertExpanded([true, false]);
  render()[1].props.children[0].props.onToggle();
  assertExpanded([true, true]);
  assert.deepEqual(visualStore.getState().visual, savedVisual, 'formula toggles do not change TOML preferences');
});

test('Target owns its calculation row, Ratio, LVTarget and Prob without nesting Cal in LVTarget', () => {
  const path = '../src/views/mtk/isp6s/ImagePane/ToneChartMapMode.tsx';
  const { axisBracket } = load(path, {}, 'axisBracket');
  const { indexedBracket } = load(path, { axisBracket }, 'indexedBracket');
  const { interpolateFields } = load(path, {}, 'interpolateFields');
  const { ToneLceTargetCard } = load('../src/views/mtk/isp6s/ImagePane/ToneChartMapMode.tsx', {
    useState: initial => [initial, () => {}],
    useId: () => 'target-formula-test-id',
    useIsp6sVisualStore: selector => selector(visualStore.getState()), ToneLceChartHeader: 'ToneLceChartHeader',
    axisBracket, indexedBracket, interpolateFields,
    calculateLceTarget, lceCardStyle: {}, lceHeaderStyle: {},
    ToneLceValueGrid: 'ToneLceValueGrid', ToneLceCalCard: 'ToneLceCalCard', ToneLceProbCard: 'ToneLceProbCard',
  }, 'ToneLceTargetCard');
  const fields = values => values.map(value => ({ value: String(value) }));
  const tables = { ratio: [[], [], []], target: [fields([1000, 2000]), fields([9999, 9999]), fields([8888, 8888])] };
  const props = { tables, position: { lv: 2.5, lvLow: 0, lvHigh: 1 }, tomlData: fixture };
  const tree = ToneLceTargetCard(props);
  assert.equal(tree.props['aria-label'], 'Tone LCE Target');
  assert.equal(tree.props.children[0].props.title, 'Target');
  assert.equal(tree.props.children[0].props.controls, tree.props.children[1].props.id);
  assert.equal(tree.props.children[1].props['data-tone-lce-target-formula'], 'true');
  assert.equal(nodes(tree.props.children[1], 'ToneLceCalCard').length, 1);
  const grids = nodes(tree, 'ToneLceValueGrid');
  assert.deepEqual(grids.map(node => [node.props.tableId, node.props.title]), [['ratio', 'Ratio'], ['target', 'LVTarget']]);
  assert.ok(grids.every(node => node.props.formula === undefined));
  assert.equal(nodes(tree, 'ToneLceProbCard').length, 1);
  const calculation = nodes(tree, 'ToneLceCalCard')[0].props.calculation;
  const grid = grids.find(node => node.props.tableId === 'target');
  assert.equal(calculation.parameterLvTarget, 1250);
  assert.equal(calculation.parameterLvTarget, interpolateFields(grid.props.rows[0], grid.props.bracket));
  assert.equal(calculation.parameterFinalTarget, 1417);
  assert.equal(calculation.finalTarget, 1988);
  // A committed draft-cell edit updates only parameter LVTarget and its downstream result.
  const edited = ToneLceTargetCard({ ...props, tables: { ...tables, target: [fields([1400, 2400]), ...tables.target.slice(1)] } });
  const changed = nodes(edited, 'ToneLceCalCard')[0].props.calculation;
  assert.equal(changed.parameterLvTarget, 1650);
  assert.equal(changed.parameterFinalTarget, 1703);
  assert.equal(changed.finalTarget, calculation.finalTarget);
  assert.equal(changed.lumaFlatTarget, calculation.lumaFlatTarget);
  for (const target of [[[], ...tables.target.slice(1)], [fields(['-', 2000]), ...tables.target.slice(1)]]) {
    const missing = nodes(ToneLceTargetCard({ ...props, tables: { ...tables, target } }), 'ToneLceCalCard')[0].props.calculation;
    assert.ok(Number.isNaN(missing.parameterLvTarget));
    assert.ok(Number.isNaN(missing.parameterFinalTarget));
    assert.equal(missing.finalTarget, 1988, 'missing parameters cannot fall back to EXIF LVTarget');
  }
  const savedVisual = visualStore.getState().visual;
  tree.props.children[0].props.onToggle();
  const collapsed = ToneLceTargetCard(props); // Remount after switching pages.
  assert.equal(collapsed.props.children[0].props.expanded, false);
  assert.equal(collapsed.props.children[1].props.hidden, true);
  assert.equal(nodes(collapsed, 'ToneLceCalCard').length, 0, 'collapse unmounts formula and its source popover');
  assert.equal(nodes(collapsed, 'ToneLceValueGrid').length, 2);
  assert.equal(nodes(collapsed, 'ToneLceProbCard').length, 1);
  assert.deepEqual(visualStore.getState().toneLceFormulaExpanded, { curve: true, targetWeight: true, target: false });
  visualStore.getState().setVisual(savedVisual);
  assert.equal(ToneLceTargetCard(props).props.children[1].props.hidden, true);
  collapsed.props.children[0].props.onToggle();
  const reopened = ToneLceTargetCard(props);
  assert.equal(reopened.props.children[1].props.hidden, false);
  assert.equal(nodes(reopened, 'ToneLceCalCard')[0].props.calculation.parameterFinalTarget, 1417);
  assert.deepEqual(visualStore.getState().visual, savedVisual);
});

test('LVTarget input previews interpolation before commit and cancels without changing source', () => {
  const path = '../src/views/mtk/isp6s/ImagePane/ToneChartMapMode.tsx';
  const { axisBracket } = load(path, {}, 'axisBracket');
  const { indexedBracket } = load(path, { axisBracket }, 'indexedBracket');
  const { interpolateFields } = load(path, {}, 'interpolateFields');
  const { isToneNumberText } = load(path, {}, 'isToneNumberText');
  const stateHost = () => {
    let cursor = 0;
    const values = [];
    return {
      reset: () => { cursor = 0; },
      useState: initial => {
        const index = cursor++;
        if (!(index in values)) values[index] = initial;
        return [values[index], value => { values[index] = value; }];
      },
      useRef: initial => {
        const index = cursor++;
        return values[index] ??= { current: initial };
      },
    };
  };
  const cardState = stateHost(), cellState = stateHost();
  const { ToneLceTargetCard } = load(path, {
    useState: cardState.useState, axisBracket, indexedBracket, interpolateFields, isToneNumberText,
    useId: () => 'target-formula-test-id',
    useIsp6sVisualStore: selector => selector(visualStore.getState()), ToneLceChartHeader: 'ToneLceChartHeader',
    calculateLceTarget, lceCardStyle: {}, lceHeaderStyle: {},
    ToneLceValueGrid: 'ToneLceValueGrid', ToneLceCalCard: 'ToneLceCalCard', ToneLceProbCard: 'ToneLceProbCard',
  }, 'ToneLceTargetCard');
  const { ToneNumberCell } = load(path, {
    useState: cellState.useState, useRef: cellState.useRef, useEffect: () => {},
    fieldChangeColor: () => undefined, lceGridColor: '',
  }, 'ToneNumberCell');
  const first = { path: 'LVTarget[0]', value: '1000' };
  const tables = { ratio: [[], [], []], target: [[first, { path: 'LVTarget[1]', value: '2000' }], [], []] };
  const commits = [], jumps = [];
  const props = { tables, sourceDraftText: 'source draft', position: { lv: 2.5, lvLow: 0, lvHigh: 1 }, tomlData: fixture,
    onCommit: (field, value) => {
      if (!isToneNumberText(value)) return false;
      commits.push(value.trim());
      tables.target = tables.target.map(row => row.map(item => item === field ? { ...item, value: value.trim() } : item));
      return true;
    }, onCellJump: (...args) => jumps.push(args),
  };
  const renderCard = () => { cardState.reset(); return ToneLceTargetCard(props); };
  const targetGrid = () => nodes(renderCard(), 'ToneLceValueGrid').find(node => node.props.tableId === 'target').props;
  const calculation = () => nodes(renderCard(), 'ToneLceCalCard')[0].props.calculation;
  let input;
  const renderInput = () => {
    const grid = targetGrid();
    cellState.reset();
    input = nodes(ToneNumberCell({ field: grid.rows[0][0], tableId: 'target', controls: grid.controls }), 'input')[0].props;
    return input;
  };
  const change = value => { renderInput().onChange({ target: { value } }); renderInput(); };
  const key = name => renderInput().onKeyDown({ key: name, preventDefault: () => {}, currentTarget: { blur: () => renderInput().onBlur() } });
  assert.equal(calculation().parameterLvTarget, 1250);
  change('1400');
  assert.equal(calculation().parameterLvTarget, 1550);
  assert.equal(calculation().parameterFinalTarget, 1632);
  assert.equal(calculation().finalTarget, 1988);
  assert.equal(interpolateFields(targetGrid().previewRows[0], targetGrid().bracket), 1550);
  assert.equal(targetGrid().rows[0][0].value, '1000');
  assert.deepEqual(commits, [], 'typing must not commit the source');
  for (const partial of ['', '-', '1e', '0x', '1e9999']) {
    change(partial);
    assert.equal(calculation().parameterLvTarget, 1550, 'partial/invalid text retains the last valid preview');
  }
  key('Escape');
  assert.equal(calculation().parameterLvTarget, 1250);
  assert.equal(renderInput().value, '1000');
  assert.deepEqual(commits, []);
  change('1400');
  key('Enter');
  assert.deepEqual(commits, ['1400'], 'Enter followed by blur commits only once');
  assert.equal(calculation().parameterLvTarget, 1550);
  change('0');
  assert.equal(calculation().parameterLvTarget, 500, 'zero previews as a valid number');
  renderInput().onBlur();
  assert.deepEqual(commits, ['1400', '0']);
  change('1600');
  renderInput().onContextMenu({ preventDefault: () => {} });
  assert.equal(jumps[0][2], '1600');
  assert.deepEqual(commits, ['1400', '0', '1600']);
  change('1800');
  tables.target = tables.target.map(row => row.map(field => ({ ...field, value: '2000' })));
  assert.equal(calculation().parameterLvTarget, 2000, 'replaced source fields cannot inherit an old preview');
  change('-');
  renderInput().onBlur();
  assert.equal(calculation().parameterLvTarget, 2000);
  assert.deepEqual(commits, ['1400', '0', '1600'], 'invalid blur must not commit partial text');
});

test('LCE chart divider restores, validates and remembers proportions in the visual store', () => {
  const { useIsp6sVisualStore: store, DEFAULT_VISUAL } = load('../src/stores/isp6sVisualStore.ts');
  const render = () => load('../src/views/mtk/isp6s/ImagePane/ToneLceCharts.tsx', {
    useCallback: callback => callback,
    useIsp6sVisualStore: selector => selector(store.getState()),
    Panel: 'Panel', PanelGroup: 'PanelGroup', ResizeHandle: 'ResizeHandle',
    ToneLceCurve: 'ToneLceCurve', ToneLceTargetWeight: 'ToneLceTargetWeight', calculateLceTarget,
  }, 'ToneLceCharts').ToneLceCharts({ tomlData: fixture });
  store.setState({ visual: DEFAULT_VISUAL });
  let tree = render();
  assert.deepEqual(nodes(tree, 'Panel').map(node => node.props.defaultSize), [50, 50]);
  const layout = nodes(tree, 'PanelGroup')[0].props.onLayout;
  layout([63.5, 36.5]);
  assert.equal(store.getState().visual.tone_lce_curve_ratio, 63.5);
  tree = render(); // Represents the chart remounting after another tab was opened.
  assert.deepEqual(nodes(tree, 'Panel').map(node => node.props.defaultSize), [63.5, 36.5]);
  for (const invalid of [[], [0, 100], [80, 20], [NaN, NaN], [50, 75], [50]]) layout(invalid);
  assert.equal(store.getState().visual.tone_lce_curve_ratio, 63.5);
  assert.notEqual(nodes(tree, 'ResizeHandle')[0].props.alwaysVisible, true);
  store.getState().setVisual({ ...DEFAULT_VISUAL, tone_lce_curve_ratio: undefined });
  assert.equal(store.getState().visual.tone_lce_curve_ratio, 50);
  for (const [saved, expected] of [[NaN, 50], [Infinity, 50], [0, 25], [100, 75], [42.25, 42.25]]) {
    store.getState().setVisual({ ...DEFAULT_VISUAL, tone_lce_curve_ratio: saved });
    assert.equal(store.getState().visual.tone_lce_curve_ratio, expected);
  }
  assert.deepEqual(store.getState().visual.workspace_column_ratios, [67, 33]);
});
