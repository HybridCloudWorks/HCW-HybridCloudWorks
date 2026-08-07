# Ephemeral GitHub Actions runner image for Azure Container Apps Jobs.
#
# One container = one CI job: the entrypoint acquires a just-in-time runner
# config from the GitHub API (via GitHub App credentials injected as Container
# Apps secrets — nothing is baked in here), executes exactly one job, and
# exits. Auto-update is disabled because ephemeral runners must never mutate
# themselves; currency comes from rebuilding this image (Dependabot bumps the
# FROM tag, and build-runner-image.yml rebuilds weekly for apt/Node patches).
#
# Node 22 is baked deliberately: ephemeral runners start with an empty tool
# cache, so actions/setup-node would re-download Node on every 15-120s CI leg.
# npm dependencies are deliberately NOT baked: they track the lockfile, would
# go stale immediately, and would put third-party code in the trusted runner
# image. No Docker-in-Docker: the CI matrix builds no images, and Container
# Apps jobs cannot run privileged containers anyway.
FROM ghcr.io/actions/runner:2.328.0

USER root

ARG NODE_VERSION=22.18.0
ARG PWSH_VERSION=7.4.11

RUN apt-get update && apt-get install -y --no-install-recommends \
      git jq curl ca-certificates xz-utils \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz" \
    | tar -xJ -C /usr/local --strip-components=1 \
    && node --version && npm --version

RUN mkdir -p /opt/microsoft/powershell/7 \
    && curl -fsSL "https://github.com/PowerShell/PowerShell/releases/download/v${PWSH_VERSION}/powershell-${PWSH_VERSION}-linux-x64.tar.gz" \
    | tar -xz -C /opt/microsoft/powershell/7 \
    && chmod +x /opt/microsoft/powershell/7/pwsh \
    && ln -s /opt/microsoft/powershell/7/pwsh /usr/local/bin/pwsh \
    && pwsh -NoProfile -Command '$PSVersionTable.PSVersion.ToString()'

COPY --chmod=755 entrypoint.sh /usr/local/bin/entrypoint.sh

USER runner
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
