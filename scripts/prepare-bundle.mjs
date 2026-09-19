/*
 * Libre WebUI
 * Copyright (C) 2025 Kroonen AI, Inc.
 * Licensed under the Apache License, Version 2.0.
 * See LICENSE in the repository root for the full license text.
 */
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = new URL('../', import.meta.url);
const runtimeFiles = [
  'native-provider-plugin.js',
  'native-provider-protocol.js',
];

function canonicalPath(value) {
  return (
    typeof value === 'string' &&
    path.isAbsolute(value) &&
    path.resolve(value) === value &&
    value !== path.parse(value).root &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

/** Create a self-contained local bundle without changing either application. */
export async function prepareBundle({ outputDirectory, socketPath }) {
  if (!canonicalPath(outputDirectory) || !canonicalPath(socketPath)) {
    throw new Error(
      'Bundle directory and socket must be absolute, normalized paths without control characters.'
    );
  }
  if (Buffer.byteLength(socketPath) > 100) {
    throw new Error('The socket path must fit within 100 UTF-8 bytes.');
  }
  if (outputDirectory === socketPath) {
    throw new Error('Bundle directory and socket path must be different.');
  }
  const source = new URL('dist/', projectRoot);
  // Fail before creating output when the checkout has not been built.
  await Promise.all(runtimeFiles.map(file => readFile(new URL(file, source))));
  const metadata = JSON.parse(
    await readFile(new URL('package.json', projectRoot), 'utf8')
  );
  const manifest = {
    name: metadata.name,
    version: metadata.version,
    description: metadata.description,
    license: metadata.license,
    repository: metadata.repository,
    homepage: metadata.homepage,
    bugs: metadata.bugs,
    engines: metadata.engines,
    private: true,
    type: 'module',
    main: './native-provider-plugin.js',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  };
  await mkdir(outputDirectory, { mode: 0o700 });
  try {
    for (const file of runtimeFiles) {
      await copyFile(new URL(file, source), path.join(outputDirectory, file));
    }
    await copyFile(
      new URL('docs/BUNDLE.md', projectRoot),
      path.join(outputDirectory, 'README.md')
    );
    await copyFile(
      new URL('LICENSE', projectRoot),
      path.join(outputDirectory, 'LICENSE')
    );
    await writeFile(
      path.join(outputDirectory, 'package.json'),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    await writeFile(
      path.join(outputDirectory, 'cordis.patch.yml'),
      `- insert:\n    - id: libre-webui-native-provider\n      name: '@libre-webui/dsh-native-provider'\n      config:\n        socketPath: ${JSON.stringify(socketPath)}\n`
    );
  } catch (error) {
    // mkdir above claimed a new directory; never remove pre-existing output.
    await rm(outputDirectory, { recursive: true, force: true });
    throw error;
  }
  return outputDirectory;
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const args = process.argv.slice(2);
  const usage =
    'Usage: npm run bundle -- /absolute/new-bundle-directory /absolute/private-directory/provider.sock';
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(usage);
  } else if (args.length !== 2) {
    console.error(usage);
    process.exitCode = 1;
  } else {
    try {
      console.log(
        await prepareBundle({ outputDirectory: args[0], socketPath: args[1] })
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
