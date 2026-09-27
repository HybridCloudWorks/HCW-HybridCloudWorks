/**
 * A lab job's resource limits are stated in four places, and they agree.
 *
 * vps-agent/index.js falls back to a default for each LABS_AGENT_* limit;
 * vps-agent/.env.example documents the same names with values; the lab
 * host's labs_agent role writes /etc/hcw/labs-agent.env from its
 * defaults/main.yml, whose comment calls them "the defaults from
 * vps-agent/.env.example"; and its meta/argument_specs.yml states each
 * default again. lab-image/sandbox-check.mjs reads index.js's defaults, so
 * it proves the image against whatever this test holds the host to.
 *
 * When the job memory moved from 256m to 512m on 2026-09-27 (the builder's
 * full default build is OOM-killed by `terraform validate` at 256m; see the
 * comment on the default in index.js), all four had to move by hand and
 * nothing would have said if one had not. The host runs the role's value,
 * not the agent's fallback, so a role default left behind is the limit that
 * is actually in force. None of these files can be imported here (index.js
 * starts the agent; the others are not JavaScript), so each is read from
 * its source text.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(path.join(repo, ...p), 'utf8');

/** env name -> labs_agent role variable. */
const LIMITS = {
  LABS_AGENT_MAX_CONCURRENT: 'labs_agent_max_concurrent',
  LABS_AGENT_POLL_MS: 'labs_agent_poll_ms',
  LABS_AGENT_JOB_MEMORY: 'labs_agent_job_memory',
  LABS_AGENT_JOB_CPUS: 'labs_agent_job_cpus',
  LABS_AGENT_JOB_PIDS: 'labs_agent_job_pids',
};

const unquote = (value) => value.trim().replace(/^(['"])(.*)\1$/, '$2');

/** `process.env.NAME || <default>` in index.js, quoted or not. */
function agentDefault(source, name) {
  const found = source.match(new RegExp(`process\\.env\\.${name} \\|\\| ([^),]+)`));
  expect(found, `vps-agent/index.js has no process.env.${name} || <default>`).not.toBeNull();
  return unquote(found[1]);
}

/** `NAME=value` in .env.example. */
function envExample(source, name) {
  const found = source.match(new RegExp(`^${name}=(.*)$`, 'm'));
  expect(found, `vps-agent/.env.example has no ${name}=`).not.toBeNull();
  return unquote(found[1]);
}

/** `variable: value` at the top level of defaults/main.yml. */
function roleDefault(source, variable) {
  const found = source.match(new RegExp(`^${variable}:\\s*(.+)$`, 'm'));
  expect(found, `labs_agent defaults/main.yml has no ${variable}`).not.toBeNull();
  return unquote(found[1]);
}

/** The `default:` inside `variable:`'s block in meta/argument_specs.yml. */
function specDefault(source, variable) {
  const start = source.search(new RegExp(`^\\s+${variable}:\\s*$`, 'm'));
  expect(start, `labs_agent argument_specs.yml has no ${variable}`).toBeGreaterThan(-1);
  const found = source.slice(start).match(/^\s+default:\s*(.+)$/m);
  expect(found, `${variable} in argument_specs.yml has no default`).not.toBeNull();
  return unquote(found[1]);
}

describe('lab job limits agree across the agent, its example env and the host role', () => {
  const index = read('vps-agent', 'index.js');
  const example = read('vps-agent', '.env.example');
  const defaults = read('lab-host', 'ansible', 'roles', 'labs_agent', 'defaults', 'main.yml');
  const specs = read('lab-host', 'ansible', 'roles', 'labs_agent', 'meta', 'argument_specs.yml');

  for (const [name, variable] of Object.entries(LIMITS)) {
    it(`${name} / ${variable}`, () => {
      const agent = agentDefault(index, name);
      expect({
        '.env.example': envExample(example, name),
        'defaults/main.yml': roleDefault(defaults, variable),
        'argument_specs.yml': specDefault(specs, variable),
      }).toEqual({
        '.env.example': agent,
        'defaults/main.yml': agent,
        'argument_specs.yml': agent,
      });
    });
  }

  it('job memory is 512m, the owner decision of 2026-09-27', () => {
    expect(agentDefault(index, 'LABS_AGENT_JOB_MEMORY')).toBe('512m');
  });
});
