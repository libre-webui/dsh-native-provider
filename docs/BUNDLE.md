# Libre WebUI native DSH provider

This is a generated local installation bundle for
`@libre-webui/dsh-native-provider`. It exposes DSH's configured model providers
to Libre WebUI through a private Unix socket. Provider credentials stay in DSH.
It does not expose native sessions, agents, tools, or attachments.

Install using the profile that runs your native DSH application:

```bash
dsh plugin --profile web add /absolute/path/to/this-bundle
```

Restart the profile after changing its plugins. Configure Libre WebUI with the
same absolute socket path recorded in this bundle's `cordis.patch.yml`. Both
applications must run on the same Unix host and as the same OS user. The private
directory uses mode `0700`; the socket uses `0600`.

For an upgrade, generate a new bundle directory, re-add it, and restart the
profile. The package name stays stable. Do not overwrite this installed copy or
delete a socket belonging to an active DSH process.

- [Source and installation guide](https://github.com/libre-webui/dsh-native-provider)
- [Configuration and troubleshooting](https://github.com/libre-webui/dsh-native-provider/blob/dev/docs/CONFIGURATION.md)
- [Security and privacy](https://github.com/libre-webui/dsh-native-provider/blob/dev/SECURITY.md)

This bundle includes a machine-specific socket path. Keep it local; build a fresh
bundle for another host. The source repository contains no local configuration.

Licensed under Apache-2.0. See the included `LICENSE` file.
