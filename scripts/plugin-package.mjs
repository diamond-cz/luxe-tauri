import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const MAX_PACKAGE_BYTES = 128 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;
const MAX_FILES = 2048;
const encoder = new TextEncoder();

function fail(message) {
  throw new Error(message);
}

function normalizeRelative(value) {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    fail(`invalid package path: ${value}`);
  }
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    fail(`invalid package path: ${value}`);
  }
  return parts.join("/");
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function walk(root, current = root) {
  const output = [];
  for (const entry of await fs.readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory() && current === root && ["native", "node_modules", ".git"].includes(entry.name)) continue;
    if (entry.isDirectory()) output.push(...await walk(root, absolute));
    else if (entry.isFile()) output.push({ absolute, relative: normalizeRelative(path.relative(root, absolute)) });
    else fail(`package contains unsupported filesystem entry: ${absolute}`);
  }
  return output;
}

async function readManifest(root) {
  const manifestPath = path.join(root, "manifest.json");
  if (!await exists(manifestPath)) fail("manifest.json is required at package root");
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch (error) {
    fail(`manifest.json is not valid JSON: ${error.message}`);
  }
  if (manifest.manifestVersion !== 1 || manifest.apiVersion !== 1) fail("manifestVersion and apiVersion must be 1");
  if (!/^[a-z][a-z0-9.-]{0,95}$/.test(manifest.id ?? "") || manifest.id.includes("..")) fail("manifest.id is invalid");
  if (!/^(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})$/.test(manifest.version ?? "")) fail("manifest.version must be major.minor.patch");
  for (const field of ["name", "author", "description"]) {
    if (typeof manifest[field] !== "string" || !manifest[field].trim()) fail(`manifest.${field} is required`);
  }
  if (manifest.entry !== "main.js") fail("manifest.entry must be main.js");
  if (!Array.isArray(manifest.permissions) || new Set(manifest.permissions).size !== manifest.permissions.length) fail("manifest.permissions must be a unique array");
  if (!Array.isArray(manifest.commands) || manifest.commands.length === 0) fail("manifest.commands must not be empty");
  for (const command of manifest.commands) {
    if (!command || typeof command.id !== "string" || typeof command.title !== "string") fail("each command requires id and title");
    if (command.handler === "native-view" && (typeof command.method !== "string" || command.method.startsWith("host/") || command.method.startsWith("plugin/"))) {
      fail(`invalid native-view method for ${command.id}`);
    }
  }
  if (manifest.backend) {
    const backend = manifest.backend;
    if (typeof backend.executable !== "string" || !backend.executable.startsWith("bin/") || backend.executable.includes("..")) fail("backend.executable must be inside bin/");
    if (backend.target !== "windows-x86_64" || backend.transport !== "stdio-jsonl") fail("luxe-image-sync requires windows-x86_64 stdio-jsonl backend");
    if (!manifest.permissions.includes("native.execute")) fail("backend requires native.execute permission");
  }
  return manifest;
}

function isPackable(relative) {
  return relative === "manifest.json" || relative === "main.js" || relative.startsWith("bin/") || relative.startsWith("ui/");
}

async function collectPayload(root, manifest) {
  const files = (await walk(root)).filter((file) => isPackable(file.relative));
  if (!files.some((file) => file.relative === "manifest.json")) fail("manifest.json is required");
  if (manifest.backend && !files.some((file) => file.relative === manifest.backend.executable)) fail(`missing backend executable: ${manifest.backend.executable}`);
  if (manifest.ui?.entry && !files.some((file) => file.relative === manifest.ui.entry)) fail(`missing UI entry: ${manifest.ui.entry}`);
  if (files.length > MAX_FILES) fail(`package contains more than ${MAX_FILES} files`);
  let total = 0;
  for (const file of files) {
    const size = (await fs.stat(file.absolute)).size;
    total += size;
    if (size > 128 * 1024 * 1024) fail(`file exceeds 128 MiB: ${file.relative}`);
  }
  if (total > MAX_UNPACKED_BYTES) fail("unpacked package exceeds 256 MiB");
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

async function sha256(file) {
  return crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex");
}

async function check(root) {
  const absoluteRoot = path.resolve(root);
  const manifest = await readManifest(absoluteRoot);
  const files = await collectPayload(absoluteRoot, manifest);
  console.log(`plugin check passed: ${manifest.id}@${manifest.version} (${files.length} payload files)`);
  return { manifest, files };
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  CRC_TABLE[index] = value >>> 0;
}
function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = (value >>> 8) ^ CRC_TABLE[(value ^ byte) & 0xff];
  return (value ^ 0xffffffff) >>> 0;
}
function dosDateTime() {
  return { date: 0, time: 0 };
}
function u16(value) { const buffer = Buffer.alloc(2); buffer.writeUInt16LE(value); return buffer; }
function u32(value) { const buffer = Buffer.alloc(4); buffer.writeUInt32LE(value >>> 0); return buffer; }

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { date, time } = dosDateTime();
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), u16(20), u16(0), u16(0), u16(time), u16(date), u32(crc32(data)), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data]);
    localParts.push(local);
    const central = Buffer.concat([Buffer.from([0x50, 0x4b, 0x01, 0x02]), u16(20), u16(20), u16(0), u16(0), u16(time), u16(date), u32(crc32(data)), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]);
    centralParts.push(central);
    offset += local.length;
  }
  const central = Buffer.concat(centralParts);
  const local = Buffer.concat(localParts);
  const end = Buffer.concat([Buffer.from([0x50, 0x4b, 0x05, 0x06]), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(central.length), u32(local.length), u16(0)]);
  return Buffer.concat([local, central, end]);
}

async function pack(root, output) {
  const { manifest, files } = await check(root);
  const checksums = { version: "1", files: [] };
  const entries = [];
  for (const file of files) {
    const data = await fs.readFile(file.absolute);
    checksums.files.push({ path: file.relative, size: data.length, sha256: crypto.createHash("sha256").update(data).digest("hex") });
    entries.push({ name: file.relative, data });
  }
  checksums.files.sort((a, b) => a.path.localeCompare(b.path));
  entries.push({ name: "checksums.json", data: encoder.encode(`${JSON.stringify(checksums, null, 2)}\n`) });
  const archive = createZip(entries);
  if (archive.length > MAX_PACKAGE_BYTES) fail("plugin package exceeds 128 MiB");
  const target = path.resolve(output);
  if (await exists(target)) fail(`refusing to overwrite existing package: ${target}`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, archive);
  const digest = crypto.createHash("sha256").update(archive).digest("hex");
  console.log(`${target}: ${archive.length} bytes, SHA-256 ${digest}`);
  console.log(`packed ${manifest.id}@${manifest.version}`);
}

const [command, source, output] = process.argv.slice(2);
try {
  if (!command || !source || (command === "pack" && !output)) fail("usage: node scripts/plugin-package.mjs check <dir> | pack <dir> <output.hvp>");
  if (command === "check") await check(source);
  else if (command === "pack") await pack(source, output);
  else fail(`unknown command: ${command}`);
} catch (error) {
  console.error(`plugin ${command ?? "command"} failed: ${error.message}`);
  process.exitCode = 1;
}
