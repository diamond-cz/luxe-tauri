import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createPluginCatalog, releaseIdentity, PLUGIN_CATALOG_URL } from './plugin-release.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugins/luxe-image-sync/manifest.json'), 'utf8'));
const tool = path.join(root, 'scripts/plugin-package.mjs');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luxe-plugin-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const plugin = path.join(dir, 'plugin');
  fs.mkdirSync(path.join(plugin, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(plugin, 'main.js'), 'export function activate() {}');
  // Package logic only: this fixture is never executed or presented as an installable native plugin.
  fs.writeFileSync(path.join(plugin, 'bin/luxe-image-sync.exe'), 'fixture');
  const save = (value) => fs.writeFileSync(path.join(plugin, 'manifest.json'), JSON.stringify(value));
  save(manifest);
  return { dir, plugin, save };
}

test('plugin has an invocable open command and declares the hidden refresh method', () => {
  const visible = manifest.commands.filter(command => !command.hidden && command.method !== 'viewer/update');
  assert.equal(visible.length, 1);
  assert.equal(visible[0].method, 'view/open');
  assert.equal(manifest.contributions[0].command, visible[0].id);
  assert.ok(manifest.commands.some(command => command.method === 'viewer/update' && command.hidden));
  assert.equal(manifest.dataVersion, 1);
});

test('package checker rejects the original hidden-only command regression and missing refresh declaration', t => {
  const f = fixture(t);
  for (const commands of [
    [{ id: 'sync', title: 'sync', handler: 'native-view', method: 'viewer/update' }],
    manifest.commands.filter(command => command.method === 'view/open'),
  ]) {
    f.save({ ...manifest, commands });
    const result = spawnSync(process.execPath, [tool, 'check', f.plugin], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /native-view requires/);
  }
});

test('source package checker rejects mismatched native handshake version', t => {
  const f = fixture(t);
  fs.cpSync(path.join(root, 'plugins/luxe-image-sync/native/Cargo.toml'), path.join(f.plugin, 'native/Cargo.toml'), { recursive: true });
  fs.copyFileSync(path.join(root, 'plugins/luxe-image-sync/native/Cargo.lock'), path.join(f.plugin, 'native/Cargo.lock'));
  fs.copyFileSync(path.join(root, 'plugins/luxe-image-sync/native/tauri.conf.json'), path.join(f.plugin, 'native/tauri.conf.json'));
  f.save({ ...manifest, version: '9.0.0' });
  const result = spawnSync(process.execPath, [tool, 'check', f.plugin], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /versions must match/);
});

test('catalog identifies the exact packed archive by immutable version, platform and SHA256', t => {
  const f = fixture(t);
  const { filename, tag } = releaseIdentity(manifest);
  const output = path.join(f.dir, filename);
  execFileSync(process.execPath, [tool, 'pack', f.plugin, output]);
  const bytes = fs.readFileSync(output);
  const catalog = createPluginCatalog(manifest, bytes);
  assert.equal(catalog.version, 1);
  assert.equal(catalog.plugins.length, 1);
  const artifact = catalog.plugins[0];
  assert.equal(artifact.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.equal(artifact.id, manifest.id);
  assert.equal(artifact.version, manifest.version);
  assert.equal(artifact.target, manifest.backend.target);
  assert.ok(artifact.url.endsWith(`/releases/download/${tag}/${filename}`));
  assert.match(PLUGIN_CATALOG_URL, /releases\/download\/luxe-plugin-updates\/plugins.json$/);
  assert.throws(() => createPluginCatalog(manifest, Buffer.from('not a ZIP')), /ZIP/);
  assert.throws(() => releaseIdentity({ ...manifest, version: 'v1.0.0' }), /identity/);
});

test('Windows updater validates versions and actual archives and stages only verified downloads', { skip: process.platform !== 'win32' }, () => {
  const shell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(root, 'scripts/plugin-update.test.ps1')], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /assertions passed/);
});
