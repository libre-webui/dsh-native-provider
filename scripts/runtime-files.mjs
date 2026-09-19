/*
 * Libre WebUI
 * Copyright (C) 2025 Kroonen AI, Inc.
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the repository root for the full license text.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';

const mode = process.argv[2];
if (!['--write', '--check'].includes(mode) || process.argv.length !== 3) {
  throw new Error('Usage: node scripts/runtime-files.mjs --write|--check');
}
const files = [
  'native-provider-plugin.js',
  'native-provider-plugin.d.ts',
  'native-provider-protocol.js',
  'native-provider-protocol.d.ts',
];
const output = new URL('../runtime/', import.meta.url);
if (mode === '--write') await mkdir(output, { recursive: true });
for (const file of files) {
  const built = await readFile(new URL(`../dist/${file}`, import.meta.url));
  const target = new URL(file, output);
  if (mode === '--write') await writeFile(target, built);
  else {
    assert.ok(
      built.equals(await readFile(target)),
      `${file} is stale; run npm run build:runtime.`
    );
  }
}
assert.deepEqual(
  (await readdir(output)).sort(),
  [...files].sort(),
  'The public runtime must contain only the four generated files.'
);
console.log(
  mode === '--write'
    ? 'Updated the public install runtime.'
    : 'Public install runtime matches the TypeScript build.'
);
