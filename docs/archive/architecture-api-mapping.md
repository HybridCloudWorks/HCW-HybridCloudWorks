# Architecture - API Mapping Journal

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Document Version:** 1.1 **Last Updated:** February 10, 2026 **Purpose:** Track all external API
integrations, how they're used, and their configuration **Update Rule:** Update this table whenever
a new API is introduced to the system

---

## Active API Integrations

### 1. Notion API

| Property              | Value                                                                    |
| --------------------- | ------------------------------------------------------------------------ |
| **Product**           | Notion                                                                   |
| **API Documentation** | https://developers.notion.com/guides/get-started/getting-started         |
| **Authentication**    | Bearer token (NOTION_API_TOKEN)                                          |
| **Primary Use**       | Master inventory of secrets/credentials with metadata                    |
| **Current Features**  | Database queries, page updates, property auto-sync                       |
| **Workflows Using**   | secrets-sync.yml, secrets-rotate-and-sync-notion.yml, secret-encrypt.yml |
| **Auto-Updates**      | Application, Notes, In Use tag, Last Modified                            |
| **Rotation**          | Annual                                                                   |
| **Status**            | ✅ Active                                                                |

**How It's Leveraged:**

- Centralized credential storage with rich metadata
- Automated sync of secrets to GitHub via workflow
- Automated tagging and application tracking
- Monthly credential rotation via workflow
- Search and audit trail for all secrets

**Configuration:**

- Database ID: `2cb0982b27b680c392e5d8fa4c797cda` (Secrets)
- Integration Name: Hybrid Cloud Works
- Scopes: Read content, Update content, Create pages

---

### 2. Firebase

| Property              | Value                                                          |
| --------------------- | -------------------------------------------------------------- |
| **Product**           | Firebase (Google Cloud)                                        |
| **API Documentation** | https://firebase.google.com/docs/reference/rest                |
| **Authentication**    | FIREBASE*TOKEN (CLI), VITE_FIREBASE*\* (SDK)                   |
| **Primary Use**       | Frontend SPA hosting, authentication, real-time database       |
| **Current Features**  | Hosting deployment, cloud functions, Firestore, authentication |
| **Workflows Using**   | frontend-deploy.yml, code-quality.yml, lighthouse-audit.yml    |
| **Rotation**          | 90 days                                                        |
| **Status**            | ✅ Active                                                      |

**How It's Leveraged:**

- React SPA deployment to Firebase Hosting
- Cloud Functions for backend logic
- Firestore for real-time database
- Firebase Authentication for user management
- Cloud Storage for file uploads

**Configuration:**

- Project ID: hybridcloudworks-61e8d
- Service Account: GCP_SA_KEY
- CLI Token: FIREBASE_TOKEN (deployed via frontend-deploy.yml)

---

### 3. GitHub API

| Property              | Value                                                 |
| --------------------- | ----------------------------------------------------- |
| **Product**           | GitHub                                                |
| **API Documentation** | https://docs.github.com/en/rest                       |
| **Authentication**    | gh CLI with GH_PAT_KEY                                |
| **Primary Use**       | Manage secrets, trigger workflows, create releases    |
| **Current Features**  | Secret management, workflow dispatch, repository ops  |
| **Workflows Using**   | All workflows (implicit), secrets-sync.yml (explicit) |
| **Rotation**          | 90 days                                               |
| **Status**            | ✅ Active                                             |

**How It's Leveraged:**

- GitHub Actions for CI/CD (frontend deployment)
- GitHub Secrets for credential storage
- Workflow automation and orchestration
- Secret syncing via `gh secret set`
- Pull request checks and status reporting

**Configuration:**

- Repository: saulpatinojr/Personal-Site_HCW
- Token Type: Personal Access Token (gh CLI)
- Scopes: repo, workflow, admin:repo_hook

---

## Planned API Integrations (Placeholders)

### 4. n8n

| Property              | Value                                     |
| --------------------- | ----------------------------------------- |
| **Product**           | n8n                                       |
| **API Documentation** | https://docs.n8n.io/api/                  |
| **Authentication**    | [TBD]                                     |
| **Primary Use**       | [TBD - Automation/workflow orchestration] |
| **Current Features**  | [Not yet integrated]                      |
| **Workflows Using**   | [None]                                    |
| **Rotation**          | [TBD]                                     |
| **Status**            | ⏳ Planned                                |

**Notes:** To be integrated for advanced workflow automation

---

### 5. Google Gemini

| Property              | Value                      |
| --------------------- | -------------------------- |
| **Product**           | Google Gemini              |
| **API Documentation** | https://ai.google.dev/docs |
| **Authentication**    | [TBD]                      |
| **Primary Use**       | [TBD - AI/ML capabilities] |
| **Current Features**  | [Not yet integrated]       |
| **Workflows Using**   | [None]                     |
| **Rotation**          | [TBD]                      |
| **Status**            | ⏳ Planned                 |

**Notes:** To be integrated for AI-powered features

---

### 6. Anthropic Claude API

| Property              | Value                              |
| --------------------- | ---------------------------------- |
| **Product**           | Claude (Anthropic)                 |
| **API Documentation** | https://docs.anthropic.com/en/docs |
| **Authentication**    | [TBD]                              |
| **Primary Use**       | [TBD - AI capabilities]            |
| **Current Features**  | [Not yet integrated]               |
| **Workflows Using**   | [None]                             |
| **Rotation**          | [TBD]                              |
| **Status**            | ⏳ Planned                         |

**Notes:** To be integrated for advanced AI features

---

### 7. Perplexity API

| Property              | Value                                |
| --------------------- | ------------------------------------ |
| **Product**           | Perplexity                           |
| **API Documentation** | https://docs.perplexity.ai/          |
| **Authentication**    | [TBD]                                |
| **Primary Use**       | [TBD - Search/research capabilities] |
| **Current Features**  | [Not yet integrated]                 |
| **Workflows Using**   | [None]                               |
| **Rotation**          | [TBD]                                |
| **Status**            | ⏳ Planned                           |

**Notes:** To be integrated for search capabilities

---

### 8. Hostinger API

| Property              | Value                             |
| --------------------- | --------------------------------- |
| **Product**           | Hostinger                         |
| **API Documentation** | https://github.com/hostinger/api/ |
| **Authentication**    | [TBD]                             |
| **Primary Use**       | [TBD - VPS management]            |
| **Current Features**  | [Not yet integrated]              |
| **Workflows Using**   | [None]                            |
| **Rotation**          | [TBD]                             |
| **Status**            | ⏳ Not needed (VPS Stage 0)       |

**Notes:** For VPS deployment (Stage 0 - not currently deployed)

---

### 9. OpenAI API

| Property              | Value                                          |
| --------------------- | ---------------------------------------------- |
| **Product**           | OpenAI                                         |
| **API Documentation** | https://platform.openai.com/docs/api-reference |
| **Authentication**    | [TBD]                                          |
| **Primary Use**       | [TBD - AI/GPT capabilities]                    |
| **Current Features**  | [Not yet integrated]                           |
| **Workflows Using**   | [None]                                         |
| **Rotation**          | [TBD]                                          |
| **Status**            | ⏳ Planned                                     |

**Notes:** To be integrated for GPT-based features

---

### 10. Portainer API

| Property              | Value                                |
| --------------------- | ------------------------------------ |
| **Product**           | Portainer                            |
| **API Documentation** | https://docs.portainer.io/api/client |
| **Authentication**    | [TBD]                                |
| **Primary Use**       | [TBD - Container management]         |
| **Current Features**  | [Not yet integrated]                 |
| **Workflows Using**   | [None]                               |
| **Rotation**          | [TBD]                                |
| **Status**            | ⏳ Planned                           |

**Notes:** For container orchestration and management

---

## Integration Update Protocol

**When adding a new API:**

1. ✅ Add row to **Active API Integrations** section
2. ✅ Include all properties from table template
3. ✅ Link to official API documentation
4. ✅ Document authentication method
5. ✅ Update **secrets-infrastructure.md** with new credential variables
6. ✅ Add new GitHub Secret (if applicable)
7. ✅ Update relevant workflows
8. ✅ Document in this file's Updates Log (below)

---

## Integration Updates Log

| Date       | API Added     | Purpose                   | Status     | Updated By  |
| ---------- | ------------- | ------------------------- | ---------- | ----------- |
| 2026-02-06 | Notion API    | Master secret inventory   | ✅ Active  | Claude Code |
| 2026-02-06 | Firebase      | Frontend SPA hosting      | ✅ Active  | Claude Code |
| 2026-02-06 | GitHub API    | CI/CD & secret management | ✅ Active  | Claude Code |
| TBD        | n8n           | Workflow automation       | ⏳ Planned | -           |
| TBD        | Google Gemini | AI capabilities           | ⏳ Planned | -           |
| TBD        | Claude API    | AI capabilities           | ⏳ Planned | -           |
| TBD        | Perplexity    | Search capabilities       | ⏳ Planned | -           |
| TBD        | Hostinger     | VPS management            | ⏳ Planned | -           |
| TBD        | OpenAI        | GPT capabilities          | ⏳ Planned | -           |
| TBD        | Portainer     | Container management      | ⏳ Planned | -           |

---

## Related Documentation

- **security-secrets-guide.md** - Credential management and Notion integration details
- **Notion API Getting Started:** https://developers.notion.com/guides/get-started/getting-started
- **Firebase REST API:** https://firebase.google.com/docs/reference/rest
- **GitHub REST API:** https://docs.github.com/en/rest

---

**Document Owner:** DevOps / Security Team **Review Frequency:** When new APIs are introduced **Last
Updated:** 2026-02-06 **Status:** ✅ Active (3 active, 7 planned)
