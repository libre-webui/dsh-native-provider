# Contributing

Use Node.js 22.22 or later and npm on macOS or Linux. This package is Apache-2.0.

```bash
npm ci
npm run check
npm audit --audit-level=moderate
```

`npm test` builds TypeScript, starts a fixture Cordis LLM service, and tests the
actual Unix socket transport. Fixtures require no provider credentials. Add a
regression for behavior changes, including cancellation and teardown.

## Implementation ownership

The plugin and wire protocol are maintained in
[Libre WebUI](https://github.com/libre-webui/libre-webui), next to their consuming
client and integration tests. This repository contains a reviewed source snapshot
and its standalone packaging/tests. Send runtime or wire-protocol changes to
Libre WebUI first, targeting `dev`; packaging and documentation changes belong
here, also targeting `dev`.

After the upstream changes have been committed:

```bash
npm run sync:lwui -- /absolute/libre-webui-checkout
npm run build:runtime
npm run check
```

The sync command copies only `native-provider-plugin.ts` and
`native-provider-protocol.ts`. It refuses dirty upstream source files and records
the commit and SHA-256 hashes in `upstream.json`. It does not copy application
configuration, keys, dependency trees, or runtime state. Review the diff before
committing. Protocol changes must remain compatible with the corresponding LWUI
client; do not silently broaden the exposed service surface.

## Distribution

Users paste `https://github.com/libre-webui/dsh-native-provider` in DSH's Add
plugin dialog. The root manifest declares `dsh.bundle`, `cordis.patch.yml` chooses
a socket below the user's DSH home, and `runtime/` contains the prebuilt entry.
Keep `prepare`, `prepack`, `prepublish`, and install hooks absent: installation
must not depend on a compiler, development dependencies, or build approval.

After runtime changes, run `npm run build:runtime` and commit its four generated
files alongside the source. `npm run check` compares those files with a fresh
build. Never edit `runtime/` by hand. The package's files whitelist also supports
a self-contained tarball; a test imports that packed artifact with no dependencies.

The package remains private to prevent accidental npm publication. A custom local
bundle can still be generated with `npm run bundle -- /absolute/new-bundle
/absolute/private/socket`; it retains its explicit path and stable package identity.

Keep temporary `dist/` output, local bundles, sockets, credentials, and real profiles
out of Git. The four verified `runtime/` distribution files are the exception.
Use a dedicated disposable profile for install tests. Do not test upgrades
by overwriting a user's installed plugin files or restarting their active profile.

Use Conventional Commits with imperative descriptions. CI validates formatting,
types, tests on Linux/macOS with Node 22/24, and dependencies. New DSH versions
require explicit compatibility testing; the pinned alpha version is deliberate.
