# portainer

Portainer Business Edition on the lab host, for the owner and nobody else
(owner decision 2026-09-26; ADR 0032, amendment of that date). A single
container with the Docker socket and a named data volume, its HTTPS UI
published on the host's loopback and reached through an SSH tunnel. There
is no Caddy route and nothing public. Off until `portainer_enabled` is true.

## What it does

1. **Fails closed** unless the publish address is `127.0.0.1`. The address
   is fixed in `vars/main.yml`, and the assertion is there so an override
   cannot move it. Portainer holds the Docker socket, which is root on this
   host, and Docker writes its own iptables rules for a published port ahead
   of ufw's, so ufw would not stop a publish on `0.0.0.0`.
2. With `portainer_enabled` true: creates the `portainer-data` volume and
   runs the `portainer` container from `portainer_image@portainer_image_digest`
   with `restart: unless-stopped`, `/var/run/docker.sock` and the volume at
   `/data`, `127.0.0.1:9443:9443`, `--http-disabled` (so the plain-HTTP port
   9000 does not listen even inside the container; neither 9000 nor the Edge
   tunnel's 8000 is published), `no-new-privileges` and a 512 MiB memory
   limit. It then waits for `https://127.0.0.1:9443/api/system/status`.
3. With it false: removes the container and keeps the volume, so turning it
   back on brings back the same administrator, settings and licence.

It creates no administrator and holds no licence key. Both are the owner's,
entered in the UI; neither is in the repository or the Ansible vault.

## Business Edition, and the licence it runs under

The owner ran Portainer EE 2.39.4 before the reinstall. Business Edition is
free under Portainer's
[3 Nodes Free licence](https://www.portainer.io/legal/3nf-license-agreement)
(last modified 2023-07-06, read 2026-09-26): "for internal business purposes
only, limited to no more than one (1) server instance and a total of three
(3) nodes including the server instance". A standalone Docker host is one
node ([what is a node](https://docs.portainer.io/faqs/licensing/what-is-a-node-for-licensing-purposes)),
so this host is one server instance and one node. The key is issued for a
year and renewed without cost each year while the use stays within three
nodes. Two clauses to keep in mind: one 3 Nodes Free licence per
organisation, and no use "to provide services to third parties". Portainer
here is the owner's administration tool; learners never reach it, and the
labs they use run in Coder. If the use ever outgrows that, the Community
Edition image `portainer/portainer-ce` is the same release under the zlib
licence with no key, and switching is a change to `portainer_image` and the
digest.

## The first-administrator window and the setup token

Two guards against someone else claiming a fresh instance, both measured on
2.45.1 on 2026-09-26:

- Until an administrator exists, Portainer stops serving five minutes after
  it starts. The container keeps running (so no restart policy brings it
  back), and every request answers **303** with `Administrator
  initialization timeout`. `sudo docker restart portainer` opens a new five
  minutes.
- Creating the administrator needs the one-time setup token Portainer prints
  in its log at every start (`setup_token=...`, "Paste it into the setup
  screen, or send it in the X-Setup-Token header"). Without it the request
  is refused with 403. The role leaves this on: `--no-setup-token` would
  remove the one guard that does not depend on the loopback.

The role's wait accepts 303 as "up" and says which state it found, so a run
that comes later does not fail on it. The owner procedure (tunnel, restart,
token, administrator, licence) is in `docs/runbooks/labs-host.md`, "Portainer
through an SSH tunnel". An 11-character administrator password was refused
and a 32-character one accepted.

## Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `portainer_enabled` | required (`false` in `group_vars`) | Run or remove the container |
| `portainer_image`, `portainer_image_tag`, `portainer_image_digest` | required | The pin; run as `image@digest` |
| `portainer_container_name` | `portainer` | The name ADR 0032's validation list checks for |
| `portainer_volume_name` | `portainer-data` | Data volume, kept while disabled |
| `portainer_https_port` | `9443` | Port on `127.0.0.1`; the address is fixed |
| `portainer_memory` | `512m` | Memory limit |

`meta/argument_specs.yml` is the contract.

## Bumping the pin

Portainer publishes LTS and STS lines, and the pin follows the newest LTS:
an STS line is superseded within weeks and gets no patches after that.
endoflife.date has no Portainer product, so nothing checks this pin
automatically (`scripts/version-floors.json`, `unsourced`). The release
list, newest first, with LTS or STS in each title; bash, anywhere with `gh`:

```bash
gh api repos/portainer/portainer/releases -X GET -f per_page=10 --jq '.[] | "\(.tag_name)  \(.published_at[0:10])  \(.name)"'
```

The digest is the image **index**, read with `docker buildx imagetools
inspect`, and cross-checked against the registry's `Docker-Content-Digest`,
which must print the same `sha256:`. Bash, anywhere with Docker:

```bash
docker buildx imagetools inspect portainer/portainer-ee:2.45.1 | head -3
```

```bash
curl -fsSI -H "Authorization: Bearer $(curl -fsS 'https://auth.docker.io/token?service=registry.docker.io&scope=repository:portainer/portainer-ee:pull' | sed -E 's/.*"token":"([^"]+)".*/\1/')" -H 'Accept: application/vnd.oci.image.index.v1+json' https://registry-1.docker.io/v2/portainer/portainer-ee/manifests/2.45.1 | grep -i docker-content-digest
```

On 2026-09-26 both printed
`sha256:0cd22f754ac52fcfceb362d5ce8f47ee23a5f6427484db17ebfaa4c8a00f7718`,
and `portainer-ee:lts`, `:latest` and `:sts` resolved to it. Portainer
migrates its database forward on start; read the release notes of every
release between the old pin and the new before moving it.

## Check mode

Safe. `docker_volume` and `docker_container` report what they would do; the
wait is skipped.
