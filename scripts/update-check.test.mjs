import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

const source = new URL('../src/services/updateCheck.ts', import.meta.url);
const { outputText } = ts.transpileModule(readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const module = { exports: {} };
new Function('require', 'module', 'exports', outputText)(
  (id) => ({
    '@tauri-apps/plugin-updater': { check: async () => null },
    '@tauri-apps/api/app': { getVersion: async () => '0.2.16' },
    '@/services/appVersion': {
      APP_VERSION: '0.2.16',
      UPDATER_MANIFEST_URL: 'https://proxy.invalid/latest.json',
    },
  }[id] ?? createRequire(source)(id)),
  module,
  module.exports,
);
const updateCheck = module.exports;

test('stable version comparison handles patch, prerelease and malformed versions', () => {
  assert.equal(updateCheck.isNewerStableVersion('0.2.17', '0.2.16'), true);
  assert.equal(updateCheck.isNewerStableVersion('0.2.16', '0.2.16'), false);
  assert.equal(updateCheck.isNewerStableVersion('0.2.16', '0.2.16-beta.1'), true);
  assert.equal(updateCheck.isNewerStableVersion('latest', '0.2.16'), null);
});

test('release metadata validation accepts only stable semantic versions', () => {
  assert.equal(updateCheck.isReleaseMetadata({ version: '0.2.16', notes: 'release' }), true);
  assert.equal(updateCheck.isReleaseMetadata({ version: '0.2.16-beta.1' }), false);
  assert.equal(updateCheck.isReleaseMetadata({ version: 0.2 }), false);
  assert.equal(updateCheck.isReleaseMetadata(null), false);
});
