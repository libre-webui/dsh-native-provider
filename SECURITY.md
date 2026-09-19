# Security

Report suspected vulnerabilities privately to
[security@kroonen.ai](mailto:security@kroonen.ai), or through
[Libre WebUI's private vulnerability reporting](https://github.com/libre-webui/libre-webui/security/advisories/new).
Include the plugin revision, DSH/LWUI versions, and a redacted reproduction.
Never include keys, session contents, or another user's data in public issues.

## Trust boundary

This plugin gives processes running as your Unix user access to inference using
the providers configured in DSH. **The Unix account is the local trust boundary**;
this is not isolation between mutually untrusted applications under that account.
Keep access to the account, plugin installation, and socket configuration trusted.

- No TCP listener, browser-authentication bypass, or application telemetry.
- A private `0700` parent directory and `0600` Unix socket; symlinks and existing
  filesystem entries are rejected.
- Provider credentials remain in DSH. Prompts can leave the machine according to
  the selected provider's configuration.
- Only DSH's LLM service is exposed. The plugin cannot create native sessions,
  invoke native agents/tools, or read native attachments on behalf of a caller.
- Requests and streams are bounded and validated. Disconnects and relevant
  provider changes cancel outstanding work.
- Libre WebUI controls its own authentication, administrator eligibility, usage,
  approvals, and Work execution boundaries.

Use reviewed source and its pinned lockfile. Public GitHub installations and
generated local bundles have no npm runtime dependencies or install/build hooks.
CI compares the committed runtime with a fresh build and audits development dependencies.
No workflow publishes to npm or changes a running application automatically.
