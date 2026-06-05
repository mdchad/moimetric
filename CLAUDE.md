# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single TanStack Start (React 19 SSR) application that demonstrates TanStack libraries (Start, Router, DB, AI, Query, Store, Form, Table) running on AWS serverless infrastructure. There is **no monorepo** — one root `package.json`. The app and its AWS CDK infrastructure live in the same repo:

- `src/webapp/` — the TanStack Start application (file-based router under `src/webapp/routes/`)
- `src/lambda/` — Lambda handlers that are not part of the Start app (SSE streaming, DynamoDB-stream→events processor, Aurora schema lifecycle)
- `lib/` — CDK constructs and the main `MoimetricStack`
- `bin/app.ts` — CDK app entrypoint (stage resolution, lifecycle, cdk-nag aspects)
- `accountSetup/` — a **separate** CDK app for one-time account bootstrap (GitHub OIDC, shared Aurora cluster). Run via `vp cdk:account`, not the main `cdk` command.

## Toolchain: Vite+ (`vp`)

This project uses **Vite+**, a unified toolchain wrapping Vite, Rolldown, Vitest, Oxlint, and Oxfmt behind a single global `vp` CLI. **Use `vp` for everything — never run `pnpm`/`npm`/`yarn`, `vitest`, or `oxlint` directly** (pnpm is only the underlying package manager `vp` wraps). See `AGENTS.md` for the full Vite+ command reference and pitfalls.

```bash
vp install            # install deps (run after pulling changes)
vp dev --port 3000    # dev server  (script: webapp:dev)
vp build              # production build (script: webapp:build runs robots-txt gen first)
vp check              # format + lint + typecheck — run before completing changes
vp check --fix        # auto-fix
vp test               # run tests (Vitest)
vp test lib/stage-name.test.ts   # run a single test file
vp lint / vp fmt      # lint / format individually
```

Type-aware linting works out of the box (`vp lint --type-aware`); do not install `oxlint-tsgolint`. Import test utilities from `vite-plus/test`, not `vitest`. `vp test` is configured to only run CDK tests in `lib/**` and `accountSetup/lib/**` (see `vite.config.ts`) — the webapp has no unit tests.

Other scripts: `vp run knip` (dead-code), `vp run seed:persons` (seed DynamoDB), `vp run test:bedrock` / `test:bedrock-budget` (manual Bedrock smoke tests via `tsx`).

## Conventions

- Do not use `any` or `as` casts to silence type errors unless genuinely unavoidable and justified.
- Import within the app via the `#src/*` alias (maps to `./src/*`), not relative paths across directories.
- CDK/`.ts` imports use explicit `.ts` extensions (`allowImportingTsExtensions` is on).
- shadcn/ui (new-york style, zinc base) lives in `src/webapp/components/ui/`; aliases are in `components.json`.

## Architecture

### Runtime — one Lambda serves everything

A single Nitro-built Lambda (`aws-lambda` preset, `streaming: true`) behind API Gateway + CloudFront serves SSR, server functions, tRPC, DB sync (SSE), and AI chat. The build is produced by the `tanstackStart` + `nitro` Vite plugins (`vite.config.ts`). React Compiler is enabled via the Babel plugin.

### Data layer — three databases, three patterns

1. **DynamoDB + TanStack DB (the headline example).** Client-side collections (`src/webapp/db-collections/persons.ts`, `todos.ts`) sync to DynamoDB single-table designs. The bridge is **TanStack Start server functions** (`createServerFn`) calling an **ElectroDB** client (`src/webapp/integrations/electrodb/`). Notably, ElectroDB attributes are **derived from Zod schemas** (`src/webapp/types/person.ts`) via `zod-to-electrodb.ts` — the Zod schema is the single source of truth for entity shape.
2. **Real-time sync via SSE.** A DynamoDB Stream on the Persons table triggers a Lambda (`StreamToEventsProcessor`) that writes change events to a separate Events DynamoDB table. Clients subscribe over Server-Sent Events (`routes/api.sse.*`, `src/lambda/sse-stream.ts`, `hooks/useSseSync.ts`). `isFromSse` guards prevent echoing locally-originated mutations.
3. **Aurora Postgres (Serverless v2, shared).** A single Aurora cluster is provisioned once by `accountSetup`. Each app stage gets its own **schema** (not its own cluster), named per stage (`lib/aurora-schema.ts`) and created/dropped by `AuroraSchemaLifecycle`. The app talks to it via the RDS Data API.

Also present: tRPC (`integrations/trpc/`, route `api.trpc.$`) and a raw DynamoDB client demo (`api.ddb-todos.ts`).

### AI chat — Bedrock

`routes/demo/api.tanchat.ts` implements streaming chat with TanStack AI over a custom **Bedrock ConverseStream adapter** (`integrations/bedrock-adapter/`). It runs a tool/agent loop (tools in `utils/demo.tools.ts`) and enforces an optional **daily spend budget** (`lib/bedrock-budget.ts`) — requests return 402 when over budget, 503 when the budget check itself fails.

### Infrastructure — stage lifecycle is load-bearing

CDK stages are either **permanent** (`main`, `prod`) or **ephemeral** (everything else, e.g. per-PR feature branches). This distinction drives removal policies, S3 auto-delete, and Aurora schema cleanup. **Two cursor rules in `.cursor/rules/` are critical and must be followed when touching CDK, `bin/`, `lib/`, `scripts/`, or workflows:**

- `cdk-stage-lifecycle.mdc` — all stage-name normalization goes through `lib/stage-name.ts`; workflow stage values resolve through `scripts/resolve-stage.ts` (never duplicate slug logic in YAML). Lifecycle classification and ephemeral cleanup happen at **app scope** in `bin/app.ts`; stacks stay focused on resource definition. Destroy workflows must be idempotent ("stack does not exist" = success). A branch that normalizes to a reserved permanent name gets prefixed (e.g. `feature-main`) to stay ephemeral.
- `cdk-cloudfront-webacl-retention.mdc` — for `prod`/`main`, the CloudFront `WebACLId` must always be resolved from existing distribution state and re-applied; **never** emit `AWS::NoValue` for it (CloudFront rejects removing a pricing-plan-protected WebACL). Fail fast if it can't be resolved.

cdk-nag (`AwsSolutionsChecks` + `ServerlessChecks`) runs as an Aspect on every synth — expect nag suppressions to be required for new resources, and CDK synth snapshot tests (`*.synth.test.ts`) will need updating when infra changes.

### Deployment

GitHub Actions deploy per stage: `deploy-feature.yml` (ephemeral, per branch), `deploy-main.yml` and `deploy-prod.yml` (permanent), `destroy-feature-on-merge.yml` (ephemeral cleanup). They share `_reusable-cdk-deploy.yml` / `_reusable-validate.yml`. The workflow→CDK contract: pass source ref to `scripts/resolve-stage.ts` with `--stage`/`--lifecycle`, write the normalized output, then set `APP_STAGE` from it.

## Agent skills (TanStack Intent)

`AGENTS.md` contains an `intent-skills` block mapping tasks to skill files shipped inside installed packages (e.g. `node_modules/@tanstack/react-start/skills/react-start/SKILL.md` for Start routes/server-functions, `@tanstack/react-db` for collections/live-queries, `nitro` for server runtime). **Load the relevant SKILL.md into context when working in those areas.** Regenerate the block with `vp run intent:install` after dependency changes (see `docs/tanstack-intent.md`).
