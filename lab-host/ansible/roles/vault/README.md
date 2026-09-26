# vault

HashiCorp Vault on the lab host, host-native under systemd, for **lab-host
secrets only** (owner decision 2026-09-26; ADR 0032, amendment of that
date). Integrated storage (raft) in `/var/lib/vault`, the API on
`127.0.0.1:8200` and raft's cluster port on `127.0.0.1:8201`, TLS with a
certificate generated on the host. Off until `vault_enabled` is true.

Not the Ansible Vault in `lab-host/README.md`, "The vault". The `vault_`
prefix on this role's variables is its name, as ansible-lint's naming rule
asks; none of them is a key in the Ansible Vault file, which holds nothing
for this role because nothing it needs is a secret.

## The boundary

This host runs untrusted learner workloads, and an escape from a workspace
or a job container is root on the host, which can read an unsealed Vault's
memory. So this Vault holds secrets **for the lab host only**, and never a
production HybridCloudWorks secret: those stay in Azure Key Vault
`kv-site-prod-cus-01`, which nothing on this host can read. Nothing may be
stored here that exists nowhere else either (ADR 0032: the host holds no
data of record), so every value in it must be one its issuer can re-issue.

## What it does

With `vault_enabled` true:

1. Installs `gpg`, `gpgv`, `openssl` and `unzip`, and creates the `vault`
   system user (no login shell).
2. Verifies the download in three links, each before the next is used:
   - HashiCorp's release signing key from
     `https://www.hashicorp.com/.well-known/pgp-key.txt`, refused unless its
     SHA256 is `vault_pgp_key_checksum`. Its primary fingerprint is
     `C874 011F 0AB4 0511 0D02 1055 3436 5D94 72D7 468F`, the one
     <https://www.hashicorp.com/en/trust/security> publishes. It is
     converted with `gpg --dearmor` into the binary keyring `gpgv` reads,
     under a file name carrying the key's checksum.
   - `gpgv` checks HashiCorp's signature on `vault_<version>_SHA256SUMS`, and
     the role refuses a `vault_checksum` that the signed file does not list
     for `vault_<version>_linux_amd64.zip`.
   - The archive is downloaded and refused unless it hashes to
     `vault_checksum`. HashiCorp signs only SHA256SUMS: "The archives
     themselves are not signed, but rather hashed."
3. Installs the binary as `/usr/local/bin/vault` and checks `vault version`
   names the pin.
4. Generates an RSA-4096 key and a self-signed certificate for `127.0.0.1`
   and `localhost` on the host if there is none (`/etc/vault.d/tls/`, key
   `root:vault 0640`, certificate `0644`, 730 days), as the `labs_agent`
   role does for the agent's, and warns on every run within 60 days of
   expiry.
5. Writes `/etc/vault.d/vault.hcl` (`root:vault 0640`),
   `/etc/profile.d/hcw-vault.sh` (`VAULT_ADDR` and `VAULT_CACERT` for login
   shells) and `vault.service`, HashiCorp's own unit minus the lines that
   exist for mlock; starts it, and restarts it when the binary, the
   configuration, the certificate or the unit changed.
6. Reads `vault status` and says which state Vault is in and whose step is
   next. `status` exits 2 when sealed; only an error (1) fails the play.

With it false, the role installs nothing, and stops and disables a Vault an
earlier run installed. `/var/lib/vault` stays, so turning it back on brings
the same, sealed, Vault back.

It never runs `vault operator init` or `unseal`, and never holds an unseal
key or a token. Those are owner steps, in `lab-host/README.md`, "HashiCorp
Vault", and the keys go to the owner's password manager and nowhere else.

**A restart seals Vault.** A changed binary, configuration, certificate or
unit restarts it, and so does every reboot, including the unattended-upgrades
reboot at 04:30. Until the owner unseals it, it answers `Sealed true` and
serves nothing. Auto-unseal with Azure Key Vault through the Arc machine's
managed identity would remove that step; it is a follow-up, not built here
(ADR 0032, amendment of 2026-09-26).

## TLS on the loopback

A certificate rather than `tls_disable`. Every request carries a token and
every answer from an unsealed Vault is a secret, and plaintext would stay
plaintext wherever the port is later carried. Self-signed, because nothing
off the host connects to 8200, so there is no CA to chain to; the CLI trusts
the one certificate through `VAULT_CACERT`. The listener requires TLS 1.3.

## mlock

`disable_mlock = true`. Vault's configuration reference (read 2026-09-26):
"You must set an explicit value for `disable_mlock` if you use integrated
storage", and "Disabling mlock is strongly recommended if using integrated
storage", because mlock pulls raft's memory-mapped BoltDB file into resident
memory. The same paragraph asks for swap to be off or encrypted in that
case, so the role prints a warning on a host with swap. It does not turn
swap off: that is a host-wide change with its own effect on the Coder
workspaces.

## Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `vault_enabled` | required (`false` in `group_vars`) | Run or stop Vault |
| `vault_version`, `vault_checksum` | required | Release, and the SHA256 of its linux amd64 zip from the signed SHA256SUMS |
| `vault_pgp_key_checksum` | required | SHA256 of HashiCorp's armored signing key |
| `vault_api_port`, `vault_cluster_port` | `8200`, `8201` | Ports on `127.0.0.1`; the address is fixed in `vars/main.yml` |
| `vault_ui` | `false` | The web UI, on the same loopback listener |
| `vault_raft_node_id` | `lab-host-01` | Fixed at first start |
| `vault_data_dir` | `/var/lib/vault` | Raft storage, `vault:vault 0700` |
| `vault_certificate_days`, `vault_certificate_warn_days` | `730`, `60` | The generated certificate |

Paths are in `defaults/main.yml`; `meta/argument_specs.yml` is the contract.

## Bumping the pin

`scripts/version-floors.json` holds `vault_version` to the newest line,
N-2 patches, from endoflife.date's `hashicorp-vault` product, and the weekly
updater moves the floor. The newest community release, bash, anywhere with
`curl` and `node`:

```bash
curl -fsS 'https://api.releases.hashicorp.com/v1/releases/vault?limit=5&license_class=oss' | node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{for(const r of JSON.parse(s))console.log(r.version,r.timestamp_created,r.is_prerelease)})"
```

The checksum is that release's `linux_amd64.zip` line in its SHA256SUMS;
2.1.1 below, change both numbers for another release:

```bash
curl -fsS https://releases.hashicorp.com/vault/2.1.1/vault_2.1.1_SHA256SUMS | grep linux_amd64.zip
```

The role verifies the file's signature on the host, so a value read from
anywhere else fails the run. A new pin restarts Vault, sealed. Read
HashiCorp's upgrade notes for every release between the old pin and the new
(<https://developer.hashicorp.com/vault/docs/updates/important-changes>),
and take a raft snapshot first once Vault holds anything (`vault operator
raft snapshot save`, with a token that may).

## Rotating the certificate

Remove the pair and re-run `bootstrap.sh`, which generates a new one and
restarts Vault. Bash, on the host:

```bash
sudo rm /etc/vault.d/tls/vault.key /etc/vault.d/tls/vault.crt && sudo /opt/hcw-src/lab-host/bootstrap.sh
```

Vault is then sealed; unseal it (`lab-host/README.md`, "HashiCorp Vault").

## Check mode

Safe. `get_url` with a checksum, `unarchive` and `shell` with `creates`, and
`template` report without writing; the signature check, the version and
certificate checks and the status read are commands, which check mode skips.
