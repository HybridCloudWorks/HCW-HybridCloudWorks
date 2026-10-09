#!/usr/bin/env node
/**
 * Hand the lab host's Coder upkeep report, and a renewed Coder status token
 * when there is one, to the site through the agent's API credential
 * (2026-10-08).
 *
 * Usage, as the agent's user with the agent's environment file loaded
 * (labs-agent.env; LABS_AGENT_API_BASE, LABS_AGENT_TENANT_ID,
 * LABS_AGENT_CLIENT_ID, LABS_AGENT_CERT_PATH, LABS_AGENT_API_SCOPE,
 * LABS_AGENT_ID), a report with no token, bash:
 *
 *   printf '%s' '{"report":{"checkedAt":"2026-10-08T04:30:00Z"}}' | node bin/report-coder-automation.js
 *
 * One JSON object on stdin: the body of POST /api/agent/reportCoderAutomation
 * without agentId. A renewed token goes in it as `statusToken`, composed so
 * that it is never an argument of a program the shell starts (a process
 * listing shows those), which is why stdin is the only way in. Success prints
 * {"ok":true,"stored":<bool>} and exits 0; failure prints the error's class
 * alone on stderr and exits 1. Everything else, and why the token is never
 * printed, is in lib/report-coder-automation.js.
 */
import { runReportCoderAutomation } from '../lib/report-coder-automation.js';

const code = await runReportCoderAutomation({
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
});

// Exit now rather than when the event loop drains: the answer is written and
// flushed, and an idle keep-alive socket in fetch or the Entra credential
// must not hold a one-shot open.
process.exit(code);
