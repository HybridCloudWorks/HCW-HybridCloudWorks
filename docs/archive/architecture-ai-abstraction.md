# ARCHITECTURE-AI-ABSTRACTION

!!! warning "Archived record"
    This page describes the Firebase-era platform or a migration step that has
    completed. It is kept as history and is not a current runbook. The current
    platform is described from the [home page](../index.md).


**Last Updated:** February 23, 2026
**Status:** Active (P3 foundation implemented)

## Purpose

Define a provider-agnostic AI interface for ContentForge so model providers can be changed by
environment configuration without frontend or admin UI changes.

## Implementation

- Shared router: `functions/lib/ai-model-router.js`
- Supported providers (config-driven):
  - `vertex` (default)
  - `openai`
  - `anthropic`
- Core exported functions:
  - `getActiveAiProvider()`
  - `generateTextResponse({...})`
  - `generateJsonResponse({...})`
  - `defaultModelFor(provider, purpose)`

## Configuration

- `CONTENTFORGE_AI_PROVIDER` = `vertex|openai|anthropic`
- Optional model overrides:
  - `CONTENTFORGE_DRAFT_MODEL`
  - `CONTENTFORGE_ANALYSIS_MODEL`
  - `CONTENTFORGE_MULTIMODAL_MODEL`
- Provider credentials:
  - Vertex: ADC / service account auth (existing)
  - OpenAI: `OPENAI_API_KEY`
  - Anthropic: `ANTHROPIC_API_KEY`

## Gemini Baseline Policy

- Gemini defaults use **2.5+ minimum**.
- Cost-prioritized defaults:
  - Draft: `gemini-2.5-flash-lite`
  - Analysis: `gemini-2.5-flash`
  - Multimodal: `gemini-2.5-flash`

## Current Wiring

- `functions/cms-functions.js`
  - `generateArticleDraft` path now uses `generateJsonResponse` via router.
- `functions/index.js`
  - Article metadata analysis now routes through router.
  - Architecture diagram multimodal analysis now routes through router.

## Guardrails

- Retry with exponential backoff for transient API failures (`429`, `503`, timeouts).
- Strict JSON parsing path for structured responses.
- Provider remains switchable without UI changes.

## Rollback

If needed, set:

- `CONTENTFORGE_AI_PROVIDER=vertex`
- Leave model overrides unset to use defaults.

This returns behavior to Vertex-native defaults while keeping the abstraction layer in place.
