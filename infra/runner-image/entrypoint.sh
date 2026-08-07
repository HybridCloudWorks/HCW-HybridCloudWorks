#!/bin/bash
# Ephemeral runner bootstrap: GitHub App credentials -> installation token ->
# just-in-time runner config -> run exactly one job -> exit.
#
# Required environment (injected by the Container Apps job from its secrets —
# see infra/ci-runner.tf and the Review.md runbook; never baked into the image):
#   GH_APP_ID            GitHub App id
#   GH_APP_INSTALLATION_ID   installation id on HybridCloudWorks
#   GH_APP_PRIVATE_KEY   the App's PEM, verbatim
#   GH_REPO_OWNER        e.g. HybridCloudWorks
#   GH_REPO_NAME         e.g. HCW-HybridCloudWorks
# Optional:
#   RUNNER_LABELS        comma-separated extra labels (default: aca)
#   RUNNER_GROUP_ID      numeric runner group id (default: 1, the Default group)
#
# JIT config (generate-jitconfig) is used instead of a classic registration
# token: the runner never appears as "offline" in the UI between jobs, cannot
# be reused, and needs no removal call on teardown — the right shape for a
# scale-to-zero job. The App JWT is signed with the Node runtime already baked
# into this image, so no extra dependencies are needed.
set -euo pipefail

: "${GH_APP_ID:?GH_APP_ID is required}"
: "${GH_APP_INSTALLATION_ID:?GH_APP_INSTALLATION_ID is required}"
: "${GH_APP_PRIVATE_KEY:?GH_APP_PRIVATE_KEY is required}"
: "${GH_REPO_OWNER:?GH_REPO_OWNER is required}"
: "${GH_REPO_NAME:?GH_REPO_NAME is required}"

RUNNER_LABELS="${RUNNER_LABELS:-aca}"
RUNNER_GROUP_ID="${RUNNER_GROUP_ID:-1}"

app_jwt="$(node --input-type=module - <<'EOF'
import { createSign } from 'node:crypto';
const now = Math.floor(Date.now() / 1000);
const b64 = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString('base64url');
// iat backdated 60s for clock drift; GitHub caps App JWTs at 10 minutes.
const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
  iat: now - 60,
  exp: now + 540,
  iss: process.env.GH_APP_ID,
})}`;
const signer = createSign('RSA-SHA256');
signer.update(unsigned);
const signature = signer.sign(process.env.GH_APP_PRIVATE_KEY, 'base64url');
process.stdout.write(`${unsigned}.${signature}`);
EOF
)"

installation_token="$(curl -fsS -X POST \
  -H "Authorization: Bearer ${app_jwt}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/app/installations/${GH_APP_INSTALLATION_ID}/access_tokens" \
  | jq -r '.token')"

runner_name="aca-$(hostname)-$(date +%s)"
labels_json="$(printf '%s' "self-hosted,linux,x64,${RUNNER_LABELS}" \
  | jq -R 'split(",") | map(select(length > 0))')"

jit_config="$(curl -fsS -X POST \
  -H "Authorization: Bearer ${installation_token}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${GH_REPO_OWNER}/${GH_REPO_NAME}/actions/runners/generate-jitconfig" \
  -d "{\"name\":\"${runner_name}\",\"runner_group_id\":${RUNNER_GROUP_ID},\"labels\":${labels_json},\"work_folder\":\"_work\"}" \
  | jq -r '.encoded_jit_config')"

if [ -z "${jit_config}" ] || [ "${jit_config}" = "null" ]; then
  echo "Failed to obtain JIT runner config" >&2
  exit 1
fi

# Don't leak credentials into the job's process environment.
unset GH_APP_PRIVATE_KEY app_jwt installation_token

cd /home/runner
exec ./run.sh --jitconfig "${jit_config}"
