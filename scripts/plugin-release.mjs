import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PLUGIN_CATALOG_URL = 'https://gh-proxy.com/https://github.com/diamond-cz/luxe-tauri/releases/download/luxe-plugin-updates/plugins.json';

export function releaseIdentity(manifest) {
  if (manifest.id !== 'luxe.image-sync' || !/^(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})$/.test(manifest.version)
    || manifest.backend?.target !== 'windows-x86_64') throw new Error('Invalid LUXE plugin release identity');
  return {
    tag: `luxe-image-sync-v${manifest.version}`,
    filename: `luxe-image-sync-${manifest.version}-windows-x86_64.hvp`,
  };
}

export function createPluginCatalog(manifest, bytes) {
  const { tag, filename } = releaseIdentity(manifest);
  if (!Buffer.isBuffer(bytes) || bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('Expected a packed .hvp ZIP archive');
  }
  return { version: 1, plugins: [{
    id: manifest.id, name: manifest.name, version: manifest.version,
    target: manifest.backend.target,
    url: `https://gh-proxy.com/https://github.com/diamond-cz/luxe-tauri/releases/download/${tag}/${filename}`,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [packagePath, output] = process.argv.slice(2);
    if (!packagePath || !output) throw new Error('usage: node scripts/plugin-release.mjs <package.hvp> <plugins.json>');
    const manifest = JSON.parse(await fs.readFile(new URL('../plugins/luxe-image-sync/manifest.json', import.meta.url), 'utf8'));
    if (path.basename(packagePath) !== releaseIdentity(manifest).filename) throw new Error('Package filename and manifest version must match');
    const catalog = createPluginCatalog(manifest, await fs.readFile(packagePath));
    await fs.writeFile(output, `${JSON.stringify(catalog, null, 2)}\n`);
    console.log(`Plugin catalog: ${output} (${manifest.id}@${manifest.version})`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
