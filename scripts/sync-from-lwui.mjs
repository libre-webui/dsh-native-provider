/*
 * Libre WebUI
 * Copyright (C) 2025 Kroonen AI, Inc.
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the repository root for the full license text.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const [checkout] = process.argv.slice(2);
if (!checkout || process.argv.length !== 3 || !path.isAbsolute(checkout)) {
  throw new Error('Usage: npm run sync:lwui -- /absolute/libre-webui-checkout');
}
const files = ['native-provider-plugin.ts', 'native-provider-protocol.ts'];
const prefix = 'backend/src/cordis/dsh/';
const git = args =>
  execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim();
if (git(['status', '--porcelain', '--', ...files.map(file => prefix + file)])) {
  throw new Error(
    'Commit the upstream plugin and protocol changes before syncing.'
  );
}
const revision = git(['rev-parse', 'HEAD']);
const sourceFiles = {};
for (const file of files) {
  // The recorded revision and copied bytes must agree even if the checkout
  // changes during synchronization or Git ignores working-tree changes.
  const source = execFileSync('git', [
    '-C',
    checkout,
    'show',
    `${revision}:${prefix}${file}`,
  ]);
  sourceFiles[prefix + file] = createHash('sha256')
    .update(source)
    .digest('hex');
  await writeFile(new URL(`../src/${file}`, import.meta.url), source);
}
await writeFile(
  new URL('../upstream.json', import.meta.url),
  `${JSON.stringify(
    {
      repository: 'https://github.com/libre-webui/libre-webui',
      revision,
      files: sourceFiles,
    },
    null,
    2
  )}\n`
);
console.log(`Synced provider implementation from Libre WebUI ${revision}.`);
