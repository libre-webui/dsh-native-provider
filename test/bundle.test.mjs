/*
 * Libre WebUI
 * Copyright (C) 2025 Kroonen AI, Inc.
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the repository root for the full license text.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareBundle } from '../scripts/prepare-bundle.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

async function temporary(t) {
  const directory = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'dsh-pkg-'))
  );
  await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('the generated bundle has complete metadata and loads without dependencies', async t => {
  const directory = await temporary(t);
  const outputDirectory = path.join(directory, 'bundle');
  const socketPath = path.join(directory, 'socket', 'llm.sock');
  await prepareBundle({ outputDirectory, socketPath });
  assert.equal((await lstat(outputDirectory)).mode & 0o777, 0o700);
  assert.deepEqual((await readdir(outputDirectory)).sort(), [
    'LICENSE',
    'README.md',
    'cordis.patch.yml',
    'native-provider-plugin.js',
    'native-provider-protocol.js',
    'package.json',
  ]);
  const metadata = JSON.parse(
    await readFile(path.join(outputDirectory, 'package.json'), 'utf8')
  );
  const project = JSON.parse(
    await readFile(path.join(root, 'package.json'), 'utf8')
  );
  for (const key of [
    'name',
    'version',
    'description',
    'license',
    'repository',
    'homepage',
    'bugs',
    'engines',
  ]) {
    assert.deepEqual(metadata[key], project[key]);
  }
  assert.equal(metadata.private, true);
  assert.equal(metadata.dependencies, undefined);
  assert.equal(metadata.devDependencies, undefined);
  assert.deepEqual(metadata.dsh, { bundle: { patch: './cordis.patch.yml' } });
  const patch = await readFile(
    path.join(outputDirectory, 'cordis.patch.yml'),
    'utf8'
  );
  assert.ok(patch.includes(`socketPath: ${JSON.stringify(socketPath)}`));
  assert.match(patch, /id: libre-webui-native-provider/);
  const license = await readFile(path.join(outputDirectory, 'LICENSE'), 'utf8');
  assert.match(license, /Apache License/);
  const readme = await readFile(
    path.join(outputDirectory, 'README.md'),
    'utf8'
  );
  assert.match(readme, /github.com\/libre-webui\/dsh-native-provider/);
  const entry = pathToFileURL(
    path.join(outputDirectory, 'native-provider-plugin.js')
  ).href;
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const p = await import(${JSON.stringify(entry)}); console.log(JSON.stringify({name:p.name,inject:p.inject,apply:typeof p.apply}));`,
    ],
    { cwd: directory, encoding: 'utf8' }
  );
  assert.deepEqual(JSON.parse(output), {
    name: 'libre-webui-native-provider',
    inject: ['llm'],
    apply: 'function',
  });
});

test('invalid paths are rejected before creating output', async t => {
  const directory = await temporary(t);
  const outputDirectory = path.join(directory, 'bundle');
  for (const socketPath of [
    undefined,
    '/',
    'relative.sock',
    '/a/../b.sock',
    '/bad\nname.sock',
    `/${'é'.repeat(51)}`,
  ]) {
    await assert.rejects(prepareBundle({ outputDirectory, socketPath }));
    await assert.rejects(lstat(outputDirectory), { code: 'ENOENT' });
  }
  await assert.rejects(
    prepareBundle({
      outputDirectory: './relative',
      socketPath: '/private/llm.sock',
    })
  );
  await assert.rejects(
    prepareBundle({ outputDirectory, socketPath: outputDirectory })
  );
  await assert.rejects(lstat(outputDirectory), { code: 'ENOENT' });
});

test('existing directories and symlinks are never overwritten', async t => {
  const directory = await temporary(t);
  const target = path.join(directory, 'existing');
  await mkdir(target);
  await writeFile(path.join(target, 'sentinel'), 'keep');
  const linked = path.join(directory, 'linked');
  await symlink(target, linked);
  for (const outputDirectory of [target, linked]) {
    await assert.rejects(
      prepareBundle({
        outputDirectory,
        socketPath: path.join(directory, 'llm.sock'),
      }),
      { code: 'EEXIST' }
    );
  }
  assert.equal(await readFile(path.join(target, 'sentinel'), 'utf8'), 'keep');
  assert.deepEqual(await readdir(target), ['sentinel']);
});

test('bundle help runs without building, installing, or creating state', () => {
  const output = execFileSync(
    process.execPath,
    [path.join(root, 'scripts/prepare-bundle.mjs'), '--help'],
    { encoding: 'utf8' }
  );
  assert.match(output, /^Usage: npm run bundle/);
});

test('recorded upstream hashes match the distributed runtime sources', async () => {
  const metadata = JSON.parse(
    await readFile(path.join(root, 'upstream.json'), 'utf8')
  );
  assert.equal(
    metadata.repository,
    'https://github.com/libre-webui/libre-webui'
  );
  assert.match(metadata.revision, /^[a-f0-9]{40}$/);
  assert.deepEqual(Object.keys(metadata.files).sort(), [
    'backend/src/cordis/dsh/native-provider-plugin.ts',
    'backend/src/cordis/dsh/native-provider-protocol.ts',
  ]);
  for (const [file, expected] of Object.entries(metadata.files)) {
    const data = await readFile(path.join(root, 'src', path.basename(file)));
    assert.equal(createHash('sha256').update(data).digest('hex'), expected);
  }
});

test('upstream sync copies committed bytes even when Git hides working-tree changes', async t => {
  const directory = await temporary(t);
  const upstream = path.join(directory, 'upstream');
  const distribution = path.join(directory, 'distribution');
  const sourcePath = 'backend/src/cordis/dsh/native-provider-plugin.ts';
  await mkdir(path.join(upstream, 'backend/src/cordis/dsh'), {
    recursive: true,
  });
  await mkdir(path.join(distribution, 'scripts'), { recursive: true });
  await mkdir(path.join(distribution, 'src'));
  await writeFile(path.join(upstream, sourcePath), 'committed plugin\n');
  await writeFile(
    path.join(upstream, 'backend/src/cordis/dsh/native-provider-protocol.ts'),
    'committed protocol\n'
  );
  const git = args =>
    execFileSync('git', ['-C', upstream, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git(['init', '--initial-branch=dev']);
  git(['add', '.']);
  git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'test: Add fixture',
  ]);
  const revision = git(['rev-parse', 'HEAD']);
  git(['update-index', '--assume-unchanged', sourcePath]);
  await writeFile(path.join(upstream, sourcePath), 'uncommitted change\n');
  const script = path.join(distribution, 'scripts/sync-from-lwui.mjs');
  await writeFile(
    script,
    await readFile(path.join(root, 'scripts/sync-from-lwui.mjs'))
  );
  execFileSync(process.execPath, [script, upstream], { stdio: 'pipe' });
  assert.equal(
    await readFile(
      path.join(distribution, 'src/native-provider-plugin.ts'),
      'utf8'
    ),
    'committed plugin\n'
  );
  const metadata = JSON.parse(
    await readFile(path.join(distribution, 'upstream.json'), 'utf8')
  );
  assert.equal(metadata.revision, revision);
  assert.equal(
    metadata.files[sourcePath],
    createHash('sha256').update('committed plugin\n').digest('hex')
  );
  git(['update-index', '--no-assume-unchanged', sourcePath]);
  assert.throws(
    () => execFileSync(process.execPath, [script, upstream], { stdio: 'pipe' }),
    /Commit the upstream/
  );
});
