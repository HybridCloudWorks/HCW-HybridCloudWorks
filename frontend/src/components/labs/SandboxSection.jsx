/**
 * "Run an agent against your landing zone" on `/education/labs` (#676,
 * Phase 3 of #658): the Docker Sandboxes recipe as a page section. Three
 * steps, one command per shell, the first prompt to paste, the cost line,
 * and a link to the recipe directory. Nothing here talks to this site — a
 * sandbox runs on the learner's machine (or Docker's cloud) and the section
 * is editorial.
 *
 * EVERY FACT BELOW WAS READ FROM THE DOCKER DOCUMENTATION ON 2026-09-25 and
 * the issue carries `live-check` because the `sbx` surface moves; re-verify
 * against these pages before changing a word of the commands:
 *   https://docs.docker.com/ai/sandboxes/                  — `sbx` CLI; local sandboxes free,
 *                                                            cloud pay-as-you-go
 *   https://docs.docker.com/ai/sandboxes/agents/claude-code/ — `sbx run claude <dir>`; base image
 *                                                            docker/sandbox-templates:claude-code
 *   https://docs.docker.com/reference/cli/sbx/create/      — `sbx create [flags] AGENT [PATH...]`,
 *                                                            `-t/--template` is the container image
 *   https://docs.docker.com/ai/sandboxes/customize/kits-v2/ — custom template: FROM the agent
 *                                                            image, run with `--template`
 *   https://docs.docker.com/ai/sandboxes/cloud/            — cloud needs a Docker Agentic Platform
 *                                                            subscription, cannot mount a host
 *                                                            workspace, expires after one hour
 *
 * THE TWO COMMANDS ARE THE SAME TEXT. `sbx run` takes the same arguments at
 * either prompt and `.` is the current directory in both, so unlike the
 * "Run it locally" lines on the cards there is no quoting to get wrong. Both
 * are still printed, each under its shell, because the site's rule is that a
 * command says which prompt it is for (.claude/CLAUDE.md), and a learner who
 * has just pasted a PowerShell-only line elsewhere on the page should not
 * have to work out whether this one is different.
 */
import React from 'react';
import { Link } from 'react-router';
import { safeUrl } from '@/lib/safeUrl';
import { staticRoutes } from '@/lib/routeFactory';
import CommandLine from './CommandLine';

const MUTED = 'text-slate-600 dark:text-slate-400';

/** The image tag the recipe's README builds and loads. */
export const TEMPLATE_TAG = 'hcw-lz-sandbox:v1';

/** The sandbox name, so `sbx run --name hcw-lz` reattaches to the same one. */
export const SANDBOX_NAME = 'hcw-lz';

/**
 * Creates the sandbox from the unzipped folder and opens Claude Code in it.
 * `sbx run` creates when the name is new and reattaches when it exists, so
 * the same line is the second visit too.
 */
export const SANDBOX_COMMANDS = Object.freeze([
  Object.freeze({
    shell: 'PowerShell',
    command: `sbx run --name ${SANDBOX_NAME} --template ${TEMPLATE_TAG} claude .`,
  }),
  Object.freeze({
    shell: 'bash',
    command: `sbx run --name ${SANDBOX_NAME} --template ${TEMPLATE_TAG} claude .`,
  }),
]);

/** The first thing to say to the agent, as one sentence. */
export const FIRST_PROMPT =
  'Explain what this landing zone deploys, then run terraform init -backend=false, terraform fmt -check and terraform validate and tell me what each printed.';

/** The recipe directory on GitHub: Dockerfile, AGENTS.md and the README with every command. */
export const RECIPE_URL =
  'https://github.com/HybridCloudWorks/HCW-HybridCloudWorks/tree/main/lab-image/sandbox-template';

export const COST_SENTENCE =
  'Local sandboxes are free. Cloud sandboxes (sbx --cloud) bill your own Docker subscription, cannot mount this folder, and expire after one hour by default.';

export default function SandboxSection() {
  const recipeHref = safeUrl(RECIPE_URL);
  return (
    <div className="flex flex-col gap-4" data-testid="sandbox-section">
      <p className={`text-sm ${MUTED} max-w-3xl`}>
        Docker Sandboxes run a coding agent in a microVM on your own machine, with the folder you
        name mounted inside and nothing else. The recipe linked below builds a template with Claude
        Code, terraform and the Azure CLI already installed, and an AGENTS.md that tells the agent
        the folder is a landing zone generated for learning: validate and explain it, never plan or
        apply it. Build and load the template once from the recipe README, store your Anthropic key
        with <code className="font-mono text-xs">sbx secret set anthropic</code>, then:
      </p>

      <ol className="list-decimal pl-5 flex flex-col gap-2 text-sm text-slate-700 dark:text-slate-300 max-w-3xl">
        <li data-testid="sandbox-step">
          Build a landing zone in the{' '}
          <Link to={staticRoutes.landingZone} className="underline underline-offset-4">
            Landing Zone Builder
          </Link>{' '}
          and download the zip.
        </li>
        <li data-testid="sandbox-step">
          Unzip it and change into the folder it made, so the Terraform files are in the current
          directory.
        </li>
        <li data-testid="sandbox-step">
          Create the sandbox from that folder and open the agent in it. Pick the line for the shell
          you are in; the folder is mounted at the same path inside the sandbox.
        </li>
      </ol>

      <div className="flex flex-col gap-3 max-w-3xl">
        {SANDBOX_COMMANDS.map((entry) => (
          <CommandLine key={entry.shell} shell={entry.shell} command={entry.command} />
        ))}
      </div>

      <p className="text-sm text-slate-700 dark:text-slate-300 max-w-3xl">
        When Claude Code opens, paste this first:{' '}
        <q className="italic" data-testid="sandbox-first-prompt">
          {FIRST_PROMPT}
        </q>
      </p>

      <p className={`text-sm ${MUTED} max-w-3xl`} data-testid="sandbox-cost">
        {COST_SENTENCE}
      </p>

      {recipeHref ? (
        <p className="text-sm max-w-3xl">
          <a
            href={recipeHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="sandbox-recipe-link"
            className="font-semibold underline underline-offset-4"
          >
            The recipe on GitHub: lab-image/sandbox-template
          </a>
          <span className={`text-xs ${MUTED}`}>
            {' '}
            (Dockerfile, AGENTS.md, and the README with the build, load and cloud commands; opens in
            a new tab)
          </span>
        </p>
      ) : null}
    </div>
  );
}
