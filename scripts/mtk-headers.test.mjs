import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, matchesGlob, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../src-tauri/resources/mtk_exif/headers/", import.meta.url));
const modules = new Set(["AE", "AF", "AWB", "ISP", "STROBE", "SHADING", "CMN", "MF", "N3D", "SENSOR", "RESVA", "RESVB", "STRING"]);
const knownInvalid = new Set([
  "AWB/AWB_6_10_9.h", "ISP/ISP_6_18_0.h", "ISP/ISP_6_18_1.h", "ISP/ISP_6_18_2.h", "ISP/ISP_6_18_3.h",
  "MF/MF_5_9_1.h", "MF/MF_6_9_1.h", "N3D/N3D_5_2_0.h", "N3D/N3D_6_2_0.h",
  "RESVA/RESVA_5_3_1.h", "RESVA/RESVA_6_3_1.h", "STROBE/STROBE_5_1_1.h", "STROBE/STROBE_6_1_1.h",
]);

function inventory(directory = root) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    assert.ok(!entry.isSymbolicLink(), "header resources must not use symlinks");
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return inventory(path);
    assert.ok(entry.isFile());
    const name = relative(root, path).split(sep).join("/");
    const parts = name.split("/");
    assert.ok(parts.length === 2 || parts.length === 4, name);
    assert.ok(modules.has(parts[0]), name);
    if (parts.length === 4) {
      assert.equal(parts[1], "variants");
      assert.match(parts[2], /^[a-f0-9]{8}$/);
    }
    const version = parts.at(-1).match(/^([A-Z][A-Z0-9]*)_([56])_(0|[1-9]\d*)_(0|[1-9]\d*)\.(h|ha)$/);
    assert.ok(version, name);
    assert.equal(version[1], parts[0], name);
    assert.ok(+version[3] <= 65535 && +version[4] <= 65535, name);
    return [{ name, path, bytes: statSync(path).size, module: version[1], generation: +version[2],
      version: +version[4] * 65536 + +version[3], signature: parts.length === 4 ? Number.parseInt(parts[2], 16) : null }];
  });
}

// This deliberately small resource audit is not the production decoder. It
// verifies the currently bundled grammar/known malformed upstream files without
// invoking a C compiler, importing Python, eval(), or executing header contents.
function auditEnum(text, signature) {
  text = text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
  const stack = [];
  let active = true;
  const selected = [];
  for (const line of text.split(/\r?\n/)) {
    const directive = line.match(/^\s*#\s*(\w+)\b(.*)$/);
    if (!directive) { if (active) selected.push(line); continue; }
    const [, name, expression] = directive;
    if (name === "if") {
      const match = expression.match(/^\s*MTK_EXIF_SIGNATURE\s*(==|!=)\s*(0x[0-9a-f]+|\d+)\s*$/i);
      assert.ok(match, "only signature conditionals may select bundled layouts");
      assert.notEqual(signature, null, "conditional layouts require an on-image signature");
      const equal = signature === Number(match[2]);
      const matched = match[1] === "==" ? equal : !equal;
      stack.push({ parent: active, matched, seenElse: false });
      active &&= matched;
    } else if (name === "else") {
      assert.equal(expression.trim(), "");
      assert.ok(stack.length && !stack.at(-1).seenElse);
      stack.at(-1).seenElse = true;
      active = stack.at(-1).parent && !stack.at(-1).matched;
    } else if (name === "endif") {
      assert.equal(expression.trim(), "");
      assert.ok(stack.length);
      active = stack.pop().parent;
    } else assert.fail(`unsupported resource directive ${name}`);
  }
  assert.equal(stack.length, 0);
  const bodies = [...selected.join("\n").matchAll(/\benum\b[^{};]*\{([^{}]*)\}/g)];
  assert.ok(bodies.length);
  const names = new Map();
  const indices = new Map();
  for (const [, body] of bodies) {
    let index = 0;
    for (const entry of body.split(",").map((value) => value.trim()).filter(Boolean)) {
      const match = entry.match(/^([A-Za-z_]\w*)(?:\s*=\s*(\d+|0x[\da-f]+|[A-Za-z_]\w*))?$/i);
      assert.ok(match, `unsupported enum entry ${entry}`);
      const [, name, value] = match;
      if (value !== undefined) index = /^\d|^0x/i.test(value) ? Number(value) : names.get(value);
      assert.ok(Number.isInteger(index) && index >= 0 && index < 16384);
      assert.ok(!names.has(name) && !indices.has(index), `non-unique enum identity ${name}`);
      names.set(name, index);
      indices.set(index++, name);
    }
  }
  return [...indices.values()];
}

const files = inventory();

test("embedded generation 5/6 catalog has bounded files, bytes, identities and canonical paths", () => {
  assert.ok(files.length > 300 && files.length <= 512);
  assert.ok(files.every((file) => file.bytes <= 512 * 1024));
  assert.ok(files.reduce((bytes, file) => bytes + file.bytes, 0) <= 32 * 1024 * 1024);
  assert.equal(new Set(files.map((file) => file.name)).size, files.length);
  for (const module of modules) assert.ok(files.some((file) => file.module === module));
  for (const generation of [5, 6]) assert.ok(files.some((file) => file.generation === generation));
  const keys = files.map((file) => `${file.module}/${file.generation}/${file.version}/${file.signature}/${file.name.endsWith(".ha") ? "ha" : "h"}`);
  assert.equal(new Set(keys).size, keys.length, "same-priority duplicate candidates cannot be silently chosen");
});

test("all resource enums are audited, and existing malformed declarations fail closed", () => {
  const invalid = new Set();
  for (const file of files) {
    try { auditEnum(readFileSync(file.path, "utf8"), file.signature ?? 0); }
    catch (error) { invalid.add(file.name); if (!knownInvalid.has(file.name)) throw error; }
  }
  assert.deepEqual(invalid, knownInvalid);
});

test("signature-conditional shared ISP enum reproduces the preserved 1647-field variant", () => {
  const text = readFileSync(join(root, "ISP/ISP_6_10_2.h"), "utf8");
  const variant = readFileSync(join(root, "ISP/variants/a56121c4/ISP_6_10_2.h"), "utf8");
  const base = auditEnum(text, 0xdf192ca9);
  const samsung = auditEnum(text, 0xa56121c4);
  assert.equal(base.length, 1649);
  assert.equal(samsung.length, 1647);
  assert.ok(base.includes("SensorRawBit"));
  assert.ok(!samsung.includes("SensorRawBit"));
  assert.deepEqual(samsung, auditEnum(variant, 0xa56121c4));
  assert.throws(() => auditEnum(text, null));
});

test("bundling is self-contained and source enumeration does not hardcode eighteen headers", () => {
  const project = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
  const build = readFileSync(join(project, "src-tauri/build.rs"), "utf8");
  const decoder = readFileSync(join(project, "src-tauri/src/image_scan/mtk_headers.rs"), "utf8");
  assert.match(build, /collect_headers\(&root, &root, &mut files\)/);
  assert.match(build, /MAX_MTK_HEADERS_BYTES/);
  assert.match(build, /cargo:rustc-env=LUXE_MTK_METADATA_REVISION=/);
  for (const file of ['mtk_exif.rs', 'mtk_headers.rs', 'mtk_ae_tables.rs', 'metadata_import.rs', 'exif_document.rs', 'metadata_source.rs']) {
    assert.ok(build.includes(`src/image_scan/${file}`), `preparation cache revision must include ${file}`);
  }
  assert.match(build, /update_revision\(&fs::read/);
  assert.match(decoder, /include!\(concat!\(env!\("OUT_DIR"\)/);
  for (const source of [build, decoder]) assert.doesNotMatch(source, /A_Private_Box|IPEParser|Command::new|std::process/);
  const config = JSON.parse(readFileSync(join(project, "src-tauri/tauri.conf.json"), "utf8"));
  const resources = config.bundle.resources;
  assert.ok(Array.isArray(resources), "audit the existing resource-list contract");
  for (const required of ["resources/translations/*.json", "resources/Isp6s.toml", "resources/normal_table.toml", "resources/face_table.toml"]) {
    assert.ok(resources.includes(required), `retain runtime resource ${required}`);
  }
  // Tauri also copies an explicitly matched directory recursively. Audit each
  // header and its ancestors so a broad resources/**/* cannot reintroduce it.
  const headerTargets = new Set(files.flatMap(({ name }) => {
    const parts = `resources/mtk_exif/headers/${name}`.split("/");
    return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
  }));
  const copiesHeaders = (rule) => [...headerTargets].some((target) => matchesGlob(target, rule.replaceAll("\\", "/")));
  for (const broad of ["resources/**/*", "resources/mtk_exif/headers/**/*", "resources/mtk_exif", "**/*"]) {
    assert.ok(copiesHeaders(broad), `audit must detect recursive copy through ${broad}`);
  }
  for (const rule of resources) {
    assert.ok(!copiesHeaders(rule), `headers are already embedded; do not bundle another disk copy with ${rule}`);
  }
});
