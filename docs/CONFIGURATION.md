# Configuration and troubleshooting

## External DSH privacy defaults

This plugin adds no telemetry uploader, but the independently running DSH
profile has its own data-sharing behavior. The following upstream defaults were
reviewed on **2026-09-21** at
[DSH revision `ddefc45`](https://github.com/deepseek-ai/deepseek-harness/tree/ddefc45fbc7f8e46dd73185e68295696d1297887):

- [OTel session exports](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/session/session-telemetry-otel/README.md)
  default to `FEEDBACK_ONLY` in base profiles. New feedback can release the
  canonical session-log prefix, including stored context, regardless of model
  provider. This can include messages, tool arguments and results, and workspace
  paths.
- [DeepSeek session-log contributions](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/session/session-log-deepseek/README.md)
  default to `enabled: true`. The `dsh_session_log` field attaches the unaccepted
  session-log suffix to DeepSeek-adapter requests with a live `sessionId`,
  including requests through configured gateways.
- [Plugin-package inventory contributions](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/llm/plugin-package-inventory-deepseek/README.md)
  default to `enabled: true`. The `dsh_plugin_packages` field adds active package
  names and versions to DeepSeek-adapter requests, including calls without a
  session ID.

The native bridge rejects `sessionId` and does not create DSH sessions, so its
direct model calls do not attach a native session log through that contributor.
Package inventory can still accompany them unless disabled. The external
[DeepSeek adapter](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/llm/llm-deepseek/README.md#wire-flow)
also supplies request identification, including a stable anonymous user ID;
the three controls below do not remove those headers.

### Disable the three upload paths

If DSH is already running, previously authorized exports can finish during
reload or shutdown. If no further delivery is acceptable, block outbound
collector traffic before editing the patch or stopping that process. Disabling
uploads does not retract data already delivered. See the
[upstream shutdown behavior](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/session/session-telemetry-otel/README.md#failures-and-shutdown).

Add or update these rows in the **external DSH profile's** `cordis.patch.yml`,
normally `$DSH_HOME/profiles/web/cordis.patch.yml` (`DSH_HOME` defaults to
`~/.dsh`). Use the profile you actually run and retain its other entries:

```yaml
- id: session-telemetry-otel
  disabled: true
  config:
    mode: DISABLED

- id: session-log-deepseek
  disabled: true
  config:
    enabled: false

- id: plugin-package-inventory-deepseek
  disabled: true
  config:
    enabled: false
```

Each row is disabled at the Loader and retains its own disabled configuration
if its row is later enabled. These are DSH profile overrides, not fields inside
this plugin's `config` or Libre WebUI's settings. Do not edit generated
`cordis.yml` or installed bundle files.

The [upstream CLI reference](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/apps/cli/reference/README.md#profile-boot)
specifies that each override replaces the targeted row's complete `config`.
Home-level `$DSH_HOME/cordis.patch.yml` and later `--patch` overlays take
precedence over profile values. Inspect the effective configuration for your
existing profile, including any overlays you use:

```bash
dsh --profile web --dump-config
```

Confirm all three rows have `disabled: true` and the configuration values above,
then restart that DSH profile. Review the effective configuration again after
changing bundles, overrides, or DSH versions.

[`DSH_TELEMETRY_DISABLED=1`](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/apps/cli/reference/README.md#shared-deployment-behavior)
on the DSH process disables only OTel; it does not disable session-log or package
inventory contributions. Blocking only the OTel collector also misses the
contributions attached to inference requests.

These opt-outs do not erase data already uploaded or promise zero network
traffic. Model inputs still go to the selected provider, and provider discovery
may make network requests. A local socket does not make a remote provider local.

## Plugin configuration

The public repository's `cordis.patch.yml` inserts one component:

```yaml
- insert:
    - id: libre-webui-native-provider
      name: '@libre-webui/dsh-native-provider'
      config:
        socketPath: !!js dshHomePath('lwui-provider/llm.sock')
```

DSH resolves `dshHomePath` against `DSH_HOME`, or `~/.dsh` by default. The path
is chosen on the machine running DSH, not the browser's machine. A custom local
bundle prepared with `npm run bundle` keeps its explicit socket path instead.

To override the socket or limits, use DSH's supported user profile
`cordis.patch.yml` (normally `$DSH_HOME/profiles/web/cordis.patch.yml`):

```yaml
- id: libre-webui-native-provider
  config:
    socketPath: /absolute/private-directory/provider.sock
    requestTimeoutMs: 600000
    maxConcurrentRequests: 8
```

Retain any other existing profile patch entries. Do not edit DSH's generated
`cordis.yml` or the installed package files. Apply profile configuration using
DSH's normal reload/restart process, then point LWUI at the same socket.

| Setting                 | Default                                                  | Accepted values                                         |
| ----------------------- | -------------------------------------------------------- | ------------------------------------------------------- |
| `socketPath`            | `<DSH home>/lwui-provider/llm.sock` in the public bundle | Absolute, normalized Unix path, at most 100 UTF-8 bytes |
| `requestTimeoutMs`      | `600000`                                                 | Integer from 10 to 3600000                              |
| `maxConcurrentRequests` | `8`                                                      | Integer from 1 to 64                                    |

Unknown configuration keys fail at startup. The timeout covers the complete
request, including provider/model lookup. A caller disconnect, timeout, profile
shutdown, or relevant provider/credential change cancels active requests.
Changes to unrelated DSH UI settings do not cancel inference.

DSH's Plugins page displays status and enable/disable switches. This package
does not add a custom graphical configuration form.

## Local connection

Both processes must share the same Unix user and filesystem view. The socket's
parent must be a physical directory owned by that user with permissions `0700`;
the socket uses `0600`. No directory component may be a symbolic link.
The plugin creates a missing private directory but refuses an unsafe existing
directory or occupied socket path.

The default socket is shared by profiles in the same DSH home. Enable it in
one profile, or override `socketPath` for additional profiles. A second running
instance refuses to replace the first one's socket.

On macOS, `/tmp` is a symbolic link; use a path below your physical home directory
for the actual connection. Shorten long home paths by choosing another physical,
private directory you own. Never relax permissions to make the connection work.

Libre WebUI also validates ownership, directory and socket permissions, and
connection identity. Its configured environment value takes precedence over
`cordis.config.yml`; an empty value explicitly disables native provider access.

A normal Docker deployment cannot reach a host Unix socket automatically. This
package's supported setup runs Libre WebUI's backend and native DSH directly
under the same Unix account. Work still executes tools in its existing Docker
sandbox. Network tunneling and exposed TCP adapters are outside this package's
supported deployment model.

## Verify without spending model tokens

After starting DSH, request the catalog through the socket:

```bash
curl --fail-with-body --unix-socket "$HOME/.dsh/lwui-provider/llm.sock" \
  -H 'Content-Type: application/json' --data '{}' \
  http://localhost/catalog
```

`localhost` is an HTTP URL placeholder for curl; transport uses the Unix socket,
not a listening TCP port. The result contains `instanceId` and model/provider
identities, with no provider keys. Catalog lookup does not run inference, though
an adapter may contact its provider to discover available models.

In Libre WebUI, refresh the Work model list, select **DeepSeek Harness**, and
check that native providers/models appear. A real test prompt uses the selected
provider and may incur its ordinary charges.

## Troubleshooting

| Symptom                                                 | Check                                                                                                                                                                                                                              |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `native-provider` still shows `0.0.0` or no description | Regenerate a bundle from this checkout, re-add its path, then restart the correct DSH profile. Do not reuse the old generated directory.                                                                                           |
| Plugin installed but no socket                          | Confirm the profile's plugin is enabled and its `llm` service is running. Read DSH's startup error; check the absolute socket path and permissions.                                                                                |
| Existing path refused                                   | Stop the owning DSH instance first. Confirm the path is a stale socket rather than a regular file or another running instance. Remove only that stale socket, then restart. Never remove a live socket to force a second listener. |
| Directory permissions refused                           | Use a dedicated directory owned by your user with mode `0700`, without symlink components. Avoid shared temporary or world-readable directories.                                                                                   |
| Native models missing in LWUI                           | Check both applications use the same socket, Cordis Engine is enabled, and the current user is an active administrator. Refresh after DSH provider changes.                                                                        |
| Provider changed / stale selection                      | Refresh the catalog and select the exact model again. The plugin intentionally invalidates in-flight requests when relevant credentials/provider settings change.                                                                  |
| Model present but requests fail                         | Verify that provider's credentials and model work in DSH. The bridge does not copy keys or fall back to another model.                                                                                                             |
| Capacity unavailable                                    | Wait for active calls or raise `maxConcurrentRequests` within its allowed range. Catalog requests also count toward the limit.                                                                                                     |
| Missing token counts                                    | Some providers do not report usage. Libre WebUI preserves missing usage rather than inventing estimates.                                                                                                                           |

## Protocol scope

The plugin supports `POST /catalog` with an empty JSON object and
`POST /generate` with an exact provider/model and validated text, reasoning, and
tool-message payloads. Generation streams newline-delimited JSON with a terminal
finish record. The `x-native-provider-instance` header identifies the current
configuration generation. This is a private integration protocol, not an
OpenAI-compatible endpoint.

Request bodies are limited to 8 MiB; stream chunks to 16 MiB; cumulative stream
output to 256 MiB. The parser rejects native file/image references, session IDs,
unknown cross-service fields, and excessive JSON complexity. Tool definitions
are data for inference; this plugin never executes tool calls.
