# node_exporter

Host metrics for Phase 3 of #656, when Azure Monitor Agent on the Arc-enabled
host scrapes them locally. Until then this is a loopback-only listener that
nothing reads, which is the intended state: ufw does not open 9100 and the
unit binds `127.0.0.1` only.

## What it does

1. Creates the `node_exporter` system user.
2. Downloads `node_exporter-<version>.linux-amd64.tar.gz` from the GitHub
   release and refuses it unless the SHA256 matches `node_exporter_checksum`.
3. Unpacks it under `/opt/node_exporter/` and copies the binary to
   `/usr/local/bin/node_exporter`.
4. Installs a systemd unit with `Restart=on-failure` and the usual sandboxing
   (`ProtectSystem=strict`, `NoNewPrivileges`, `PrivateTmp`) and starts it.

## Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `node_exporter_version` | required | Release version, no leading `v` |
| `node_exporter_checksum` | required | `sha256:<hex>` of the linux-amd64 tarball |
| `node_exporter_listen_address` | `127.0.0.1:9100` | `--web.listen-address` |
| `node_exporter_user` | `node_exporter` | Service user |
| `node_exporter_install_dir` | `/opt/node_exporter` | Download and unpack location |
| `node_exporter_binary_path` | `/usr/local/bin/node_exporter` | Installed binary |
| `node_exporter_extra_args` | `[]` | Extra flags for `ExecStart` |

To bump, change both pins in `group_vars/all.yml`. The bash line below prints
the checksum line for the newest release:

```bash
curl -sL "https://github.com/prometheus/node_exporter/releases/latest/download/sha256sums.txt" | grep linux-amd64
```

## Handlers

`Restart node_exporter` (with `daemon_reload`).

## Check mode

Safe. `get_url` with a checksum, `unarchive` with `creates` and `copy` with
`remote_src` all report without writing.
