/*
 * Libre WebUI
 * Copyright (C) 2025 Kroonen AI, Inc.
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the repository root for the full license text.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('the public package ships a portable DSH bundle and loads without build scripts or dependencies', async t => {
  const directory = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'dsh-public-'))
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const packed = JSON.parse(
    execFileSync(
      'npm',
      ['pack', '--json', '--ignore-scripts', '--pack-destination', directory],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
  )[0];
  const extraction = path.join(directory, 'extracted');
  await mkdir(extraction);
  execFileSync('tar', [
    '-xzf',
    path.join(directory, packed.filename),
    '-C',
    extraction,
  ]);
  const installed = path.join(extraction, 'package');
  const manifest = JSON.parse(
    await readFile(path.join(installed, 'package.json'), 'utf8')
  );
  assert.equal(manifest.name, '@libre-webui/dsh-native-provider');
  assert.equal(manifest.main, './runtime/native-provider-plugin.js');
  assert.deepEqual(manifest.dsh, { bundle: { patch: './cordis.patch.yml' } });
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.peerDependencies, undefined);
  for (const hook of [
    'prepare',
    'prepack',
    'prepublish',
    'prepublishOnly',
    'preinstall',
    'install',
    'postinstall',
  ]) {
    assert.equal(
      manifest.scripts?.[hook],
      undefined,
      `${hook} would make UI installation depend on a local build`
    );
  }
  const patch = await readFile(
    path.join(installed, manifest.dsh.bundle.patch),
    'utf8'
  );
  assert.match(patch, /id: libre-webui-native-provider/);
  assert.match(
    patch,
    /socketPath: !!js dshHomePath\('lwui-provider\/llm\.sock'\)/
  );
  assert.doesNotMatch(patch, /\/Users\/|\/home\//);
  assert.ok(!(await readdir(installed)).includes('node_modules'));
  assert.ok(
    packed.files.every(file => !/^(?:src|test|scripts|dist)\//.test(file.path))
  );
  const entry = pathToFileURL(path.join(installed, manifest.main)).href;
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const p=await import(${JSON.stringify(entry)}); console.log(JSON.stringify({name:p.name,inject:p.inject,apply:typeof p.apply}));`,
    ],
    { cwd: extraction, encoding: 'utf8' }
  );
  assert.deepEqual(JSON.parse(output), {
    name: 'libre-webui-native-provider',
    inject: ['llm'],
    apply: 'function',
  });
});
