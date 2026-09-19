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
npm run check
```

The sync command copies only `native-provider-plugin.ts` and
`native-provider-protocol.ts`. It refuses dirty upstream source files and records
the commit and SHA-256 hashes in `upstream.json`. It does not copy application
configuration, keys, dependency trees, or runtime state. Review the diff before
committing. Protocol changes must remain compatible with the corresponding LWUI
client; do not silently broaden the exposed service surface.

## Distribution

The package is private to prevent accidental npm publication. Users build a local
bundle with `npm run bundle`; its metadata includes the repository package version
and its runtime has no npm dependencies. The package identity and component ID
are stable so a new local bundle can replace an existing installation through
DSH's supported plugin manager.

Keep build output, generated bundles, sockets, credentials, and real profiles out
of Git. Use a dedicated disposable profile for install tests. Do not test upgrades
by overwriting a user's installed plugin files or restarting their active profile.

Use Conventional Commits with imperative descriptions. CI validates formatting,
types, tests on Linux/macOS with Node 22/24, and dependencies. New DSH versions
require explicit compatibility testing; the pinned alpha version is deliberate.
