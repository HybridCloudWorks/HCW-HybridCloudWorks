# Gist Template

Use this template for new gists to maintain consistency.

---

````markdown
# 🎯 What This Does

[1-2 sentence hook - the problem this solves]

---

## 🧠 Why These Choices

| Decision     | Reason      |
| ------------ | ----------- |
| **Choice 1** | Because...  |
| **Choice 2** | Enables...  |
| **Choice 3** | Improves... |

---

## 📦 Prerequisites

```bash
# Installation commands
pip install example-package
```
````

---

## 💻 The Code

```language
# Your heavily commented code here
# - Explain the "why" not just the "what"
# - Reference Zero Trust principles
# - Include error handling examples
```

---

## 🔐 Zero Trust Alignment

| Principle             | How This Helps            |
| --------------------- | ------------------------- |
| **Verify Explicitly** | [specific implementation] |
| **Least Privilege**   | [specific implementation] |
| **Assume Breach**     | [specific implementation] |

---

## 🔗 Learn More

- [Link 1](https://...)
- [Link 2](https://...)

---

## 📝 License

MIT - Use freely, attribution appreciated!

---

_Part of the "Zero Trust for the AI Era" session series_

```

---

## Gist Naming Convention

Format: `NN-descriptive-name.md`

- `NN`: Two-digit number (01-12)
- Use lowercase with hyphens
- Be descriptive but concise

## Publishing to GitHub Gist

1. Copy the markdown content
2. Create new gist at https://gist.github.com
3. Use `.md` extension for the filename
4. Add description matching the "What This Does" section
5. Choose "Create public gist"

## File Structure

```

gists/
├── GIST_TEMPLATE.md ← This file
├── 01-managed-identity-for-ai.md
├── 02-abac-conditions-ai-data.md
├── 03-network-isolation-ai-vlan.md
├── 04-cluster-resource-quotas-ai.md
├── 05-arc-onboard-server.md
├── 06-data-classification-policy.md
├── 07-model-signing-verification.md
├── 08-secured-core-validation.md
├── 09-foundry-iq-rag-agent.md
├── 10-prompt-injection-filter.md
├── 11-ai-security-kql-queries.md
└── 12-zero-trust-assessment-demo.md

```

```
