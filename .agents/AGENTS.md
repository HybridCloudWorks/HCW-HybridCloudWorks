# Project Rules & Custom Agent Definitions

## What `.agents/` and `.claude/` are — read this first

These two directories are the **agent harness**: agent role definitions, skills,
playbooks and orchestration config that drive tooling *against* this repository.
They are deliberately source-controlled and must stay that way.

They are **not** the site, and they are **not** human-facing project
documentation. Treat them accordingly:

- **Leverage them.** Before starting work in a domain, check `.claude/agents/`
  for a matching persona and `.claude/skills/` for a matching skill, and load it
  rather than reinventing the approach.
- **Do not scan them as project content.** They are excluded from the
  documentation policy in `scripts/validate-repository-structure.ps1` — both
  from the allowed-root-directory check and from the Markdown scan, which prunes
  them from the walk entirely. A repository-wide search for site content, docs
  or source should skip them; a search for agent capability should target them.
  Roughly 4,470 of the Markdown files in this repository live here, so scanning
  them is almost always noise.

The documentation policy that sends human-facing docs to the GitHub Wiki applies
to the rest of the repository, not to the harness.

## Skills Registration
Workspace agentic skills located in `.claude/skills/` are registered via [.agents/skills.json](file:///c:/Users/saulp/Workspace/HCW-HybridCloudWorks/.agents/skills.json).

## Specialized Agents
The repository contains 38 specialized agent role definitions under [.claude/agents/](file:///c:/Users/saulp/Workspace/HCW-HybridCloudWorks/.claude/agents). When executing tasks matching these domains, load and follow the corresponding persona guidelines:
- **Agentic Workflows**: [agentic-workflow-engineer.md](file:///c:/Users/saulp/Workspace/HCW-HybridCloudWorks/.claude/agents/agentic-workflow-engineer.md)
- **AWS Architect**: [aws-architect.md](file:///c:/Users/saulp/Workspace/HCW-HybridCloudWorks/.claude/agents/aws-architect.md)
- **Azure Architect**: [azure-architect.md](file:///c:/Users/saulp/Workspace/HCW-HybridCloudWorks/.claude/agents/azure-architect.md)
- **Security Engineer**: [security-engineer.md](file:///c:/Users/saulp/Workspace/HCW-HybridCloudWorks/.claude/agents/security-engineer.md)
- **FinOps Practice Lead**: [finops-practice-lead.md](file:///c:/Users/saulp/Workspace/HCW-HybridCloudWorks/.claude/agents/finops-practice-lead.md)
- **Kubernetes FinOps Engineer**: [kubernetes-finops-engineer.md](file:///c:/Users/saulp/Workspace/HCW-HybridCloudWorks/.claude/agents/kubernetes-finops-engineer.md)
- *(and 32 other domain specialist agents in `.claude/agents/`)*
