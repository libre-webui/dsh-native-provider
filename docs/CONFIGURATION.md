# Configuration and troubleshooting

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
