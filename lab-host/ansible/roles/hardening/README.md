# hardening

The first role `site.yml` runs. It replaces the "Harden the Hostinger VPS" step
the admin Labs page's Setup tab used to ask the owner to do by hand.

## What it does

1. Installs the packages it configures, `sudo` included: a minimal image may
   not ship it, and both the administrative user's access and the play's own
   `become` depend on it (`bootstrap.sh` installs it too, before Ansible
   ever runs, for the same reason). Creates `hcwadmin` with passwordless
   sudo (`/etc/sudoers.d/90-hcw-admin`, validated with `visudo`) and
   installs its public keys. With
   `hardening_admin_authorized_keys` empty the keys are copied from
   `/root/.ssh/authorized_keys`, which is where the Hostinger provisioner
   puts the key Terraform passes it. The role **refuses to continue** if no
   key is found from either source, because the next step would lock the
   host.
2. Writes `/etc/ssh/sshd_config.d/00-hcw-hardening.conf` with
   `PasswordAuthentication no`, `PermitRootLogin no` and
   `KbdInteractiveAuthentication no`, validated with `sshd -t`. The `00-`
   prefix matters: sshd keeps the first value it reads and Ubuntu's cloud
   image ships `50-cloud-init.conf` with `PasswordAuthentication yes`.
3. ufw: default deny inbound, allow outbound, allow TCP 22, 80, 443. Docker
   publishes no ports on this host (jobs run with `--network none`, Caddy
   binds directly), so Docker's iptables chains never open anything ufw did
   not.
4. `unattended-upgrades` with `Automatic-Reboot` at
   `hardening_unattended_reboot_time`.
5. A fail2ban `sshd` jail on the systemd backend, which reads sshd's
   journal directly, so the jail works on 26.04 and 24.04 whether or not
   rsyslog is installed to write `/var/log/auth.log`.

## Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `hardening_admin_user` | `hcwadmin` | The key-only administrative login |
| `hardening_admin_authorized_keys` | `[]` | Public keys; empty copies root's |
| `hardening_ufw_allowed_tcp_ports` | `[22, 80, 443]` | Inbound TCP allowlist |
| `hardening_ufw_logging` | `low` | ufw logging level |
| `hardening_unattended_reboot_time` | `04:30` | Reboot hour for unattended upgrades |
| `hardening_fail2ban_maxretry` | `5` | Failures before a ban |
| `hardening_fail2ban_findtime` | `10m` | Counting window |
| `hardening_fail2ban_bantime` | `1h` | Ban length |

`meta/argument_specs.yml` is the contract; the table is a summary of it.

## Handlers

`Restart ssh`, `Restart unattended-upgrades`, `Restart fail2ban`.

## Check mode

Safe. Every task is a module with check-mode support; `sshd -t` and `visudo -cf`
run against the rendered temporary file, not the live one.
