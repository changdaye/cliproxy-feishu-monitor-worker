# Cloudflare Worker Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Cloudflare Worker + Queues + D1 monitor that fetches CLIProxyAPI quota and usage data and pushes summarized Feishu notifications without a dedicated server.

**Architecture:** A single Worker exposes `fetch`, `scheduled`, and `queue` handlers. Scheduled runs create monitoring batches and finalize completed ones; queue consumers process quota chunks and persist results in D1.

**Tech Stack:** TypeScript, Wrangler, Cloudflare Workers, Cloudflare Queues, Cloudflare D1, Vitest.

---

### Task 1: Scaffold project and quality gates

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `wrangler.jsonc`
- Create: `.github/workflows/ci.yml`
- Create: `.editorconfig`
- Create: `.gitignore`

- [ ] Step 1: Add project metadata, scripts, and Cloudflare dependencies.
- [ ] Step 2: Add TypeScript and Vitest configuration.
- [ ] Step 3: Add Wrangler configuration with cron, D1, and Queue bindings.
- [ ] Step 4: Add CI to run `npm run check`.

### Task 2: Add D1 schema and repository helpers

**Files:**
- Create: `migrations/0001_init.sql`
- Create: `src/db.ts`

- [ ] Step 1: Define D1 schema for runs, chunks, reports, and runtime state.
- [ ] Step 2: Implement repository helpers for state, run creation, chunk tracking, and summary persistence.

### Task 3: Add pure monitor logic

**Files:**
- Create: `src/lib/chunk.ts`
- Create: `src/lib/quota.ts`
- Create: `src/lib/value.ts`
- Create: `src/lib/message.ts`
- Test: `test/chunk.test.ts`
- Test: `test/quota.test.ts`

- [ ] Step 1: Port quota parsing, status derivation, and summary building logic from the Go implementation.
- [ ] Step 2: Add focused unit tests for chunking and status calculation.

### Task 4: Add upstream service clients

**Files:**
- Create: `src/config.ts`
- Create: `src/services/cliproxy.ts`
- Create: `src/services/feishu.ts`

- [ ] Step 1: Parse environment bindings into runtime config.
- [ ] Step 2: Implement CLIProxyAPI client methods for auth files, usage, and quota proxy calls.
- [ ] Step 3: Implement Feishu push client with optional signing.

### Task 5: Add Worker orchestration handlers

**Files:**
- Create: `src/index.ts`
- Create: `src/types.ts`
- Test: `test/message.test.ts`

- [ ] Step 1: Implement `fetch` health endpoint.
- [ ] Step 2: Implement `scheduled` orchestration for startup notice, heartbeat, run creation, and finalization.
- [ ] Step 3: Implement `queue` consumer processing and D1 updates.

### Task 6: Verify and commit

**Files:**
- Modify: `README.md`

- [ ] Step 1: Run `npm install`.
- [ ] Step 2: Run `npm run check` and fix failures.
- [ ] Step 3: Update README deployment steps if commands changed.
- [ ] Step 4: Commit using Lore protocol.
