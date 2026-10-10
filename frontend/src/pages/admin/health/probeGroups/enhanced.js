/** The Enhanced hub's probes (ADR 0033 §1 Platform, §8): narration, the lab agents and the lab routes. */
import { LABS, fromService, liveProbe, sessionProbe } from '../probeKit';
import { evaluateLabsSession, evaluateUnauthSession } from '../probeEvaluators';
import { runLabAgents, runLabCheck } from '../probeRunners';

export const ENHANCED_PROBES = [
  fromService('elevenlabs', {
    hub: 'enhanced',
    covers: 'Podcast narration.',
    impact: 'Episodes cannot be rendered.',
    action: 'Check credits on the Audio tab; rotate the key on Keys.',
  }),
  liveProbe({
    id: 'lab-agents',
    label: 'Lab agents',
    hub: 'enhanced',
    covers: 'The registered lab agents and their 30-second heartbeat.',
    impact: 'Lab jobs queue with nothing to run them.',
    action: 'Restart the agent on the VPS; the Labs Agents tab shows which is offline.',
    href: LABS,
    run: runLabAgents,
  }),
  liveProbe({
    id: 'lab-drift',
    label: 'Lab host runs main',
    hub: 'enhanced',
    covers:
      'The commit each lab host last converged from, against main’s lab-host/ and vps-agent/ changes; raised a day after a change merges unapplied.',
    impact: 'Merged lab fixes, security ones included, are not running on the host.',
    action:
      'Run bootstrap.sh on the lab host; the Labs Agents tab names the commit each host runs.',
    href: LABS,
    run: () => runLabCheck('lab-drift'),
  }),
  liveProbe({
    id: 'coder-template',
    label: 'Coder template published',
    hub: 'enhanced',
    covers:
      'Whether Coder serves the hcw-lab template of the commit the host converged from, from the host’s daily Coder upkeep report.',
    impact: 'Workspaces start from an older template, with older images or settings.',
    action: 'Run bootstrap.sh, or hcw-coder-automation push-template on the lab host.',
    href: LABS,
    run: () => runLabCheck('coder-template'),
  }),
  sessionProbe({
    id: 'labs-noop',
    label: 'Labs job round trip',
    hub: 'enhanced',
    covers: 'Enqueue a shell-echo job as the console does, read it back, cancel it.',
    impact: 'The Labs console cannot submit jobs.',
    action: 'Run it from the card below; a job left queued is named with its id.',
    href: LABS,
    safe: false,
    costNote: 'Creates and cancels a real lab job.',
    evaluate: evaluateLabsSession,
    run: (ctx) => ctx.actions.runLabs(),
  }),
  sessionProbe({
    id: 'labs-unauth',
    label: 'Labs refuses anonymous jobs',
    hub: 'enhanced',
    covers: 'The same enqueue with no Authorization header must be refused.',
    impact: 'A 200 here means anyone can queue work on the lab.',
    action: 'If it passes anonymously, stop and check the route guard before anything else.',
    href: LABS,
    safe: true,
    evaluate: evaluateUnauthSession,
    run: (ctx) => ctx.actions.runUnauth(),
  }),
  fromService('hybrid-lab', {
    hub: 'enhanced',
    covers: 'Coder workspaces and the Turnstile check behind the public labs page.',
    impact: 'The labs page says the lab is not provisioned.',
    action: 'Seed CODER-URL and CODER-STATUS-TOKEN on Keys.',
  }),
  fromService('migration-addon', {
    hub: 'enhanced',
    covers: 'Whether the migration add-on answers its health read.',
    impact: '/tools/migration says the tool is unavailable.',
    action: 'Check the add-on container on the lab host (runbook, "Tool add-ons").',
  }),
];
