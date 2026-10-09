# MVP V0.1 Milestones

Each milestone follows the vertical-slice principle (see README.md Section 21 context / Overview): prove the full loop narrowly before broadening coverage.

## M1. Walking Skeleton (no AI)
Hand-build one example app (Todo) directly as the Expo + Supabase scaffold (navigation, auth, data layer). Verify Expo Web preview and EAS APK build actually work end-to-end before any AI generation is involved.

**Goal:** validate the execution/preview/APK pipeline independent of generation quality.

## M2. AI Fills the Template — DONE (2026-10-06)
Feed a hardcoded structured spec (JSON) to the AI and have it fill app-specific screens/data models into the M1 scaffold. Run build validation, show result in Expo Web preview. No chat/requirement-analysis interface yet.

**Goal:** validate AI code generation into the template + the build-validation loop.

**Result:** `generator/generate.js` takes a spec (`generator/specs/*.json`), copies the reusable parts of `app-template`, prompts Gemini with the existing Todo files as a pattern reference, writes the generated data-layer/screen/SQL files, then runs `tsc --noEmit` + `expo export -p web` as build validation before declaring success. Verified end-to-end with a Shopping List spec: generated code passed both validation steps and, after applying the generated SQL, worked correctly in the browser (signup/login reused, add/toggle/delete items all functional).

Notes for later:
- Model used: `gemini-3.1-flash-lite` (free tier). `gemini-3.8-flash` / `gemini-flash-latest` returned 503 (overloaded) repeatedly during testing — worth re-checking availability before relying on a specific model name, and this is exactly the kind of place the future model-routing work (see below) would slot in.
- The AI output format relies on a simple `===FILE: path===` delimiter convention parsed by regex — fragile if the model deviates; fine for a hardcoded single-spec proof but will need hardening (e.g. retry-on-parse-failure, or structured output mode) once M3 feeds it real, less-controlled user requests.
- node_modules is copied from `app-template` into each generated project rather than reinstalled, to keep iteration fast. Fine for local dev; revisit for M5's real multi-project infra.

## M3. Requirement Analysis Loop — DONE (2026-10-06)
Add the natural-language chat flow: user prompt -> clarifying questions -> structured spec. Connect its output to M2's generation pipeline.

**Goal:** close the loop from a real user prompt to a generated preview.

**Result:** `generator/analyze.js` takes a free-text request, asks Gemini (constrained by a system prompt to the V0.1 "single-resource list screen" shape) to either ask ONE short product-level clarifying question or emit a final structured spec matching `generator/specs/*.json`'s shape. On a finalized spec it writes the spec file and automatically chains into `generate.js` (M2). Verified end-to-end twice: an unambiguous prompt ("습관 트래커 앱...") finalized in one turn; an ambiguous one ("쇼핑몰 재고 관리 앱") triggered one clarifying question, and after answering it the full chain (spec -> generation -> tsc -> expo export) passed.

Notes for later:
- **Design change from the original plan:** a long-lived interactive terminal REPL (`readline`) does not work in this environment — neither Claude's own command execution nor the chat's `!`-prefixed passthrough provide a real attached TTY, so `readline`'s interface closes as soon as the piped stdin reports EOF. Switched to a stateless-per-invocation design instead: conversation history is persisted to `.active-analysis-session.json` between runs, and the human re-runs `node analyze.js "<answer>"` for each turn. This turned out to be the right call anyway for a future real UI (web chat), since a web backend handling one HTTP request per message is the same shape — no long-lived process/connection assumption to unwind later.
- Same caveats as M2 carry over here (delimiter-based parsing fragility, model availability).

## M4. Real Backend Provisioning — DONE (2026-10-06)
Replace the static/dummy Supabase project with automatic per-project schema creation (tables, RLS policies) derived from the spec. Verify real persistent CRUD through the generated app.

**Goal:** prove the backend side of "frontend + backend + infra connected automatically" (README Section 11).

**Isolation decision:** one shared Supabase project for the whole platform, NOT one Supabase project per user/app. Reasoning: Supabase's free tier caps active projects per organization (around 2), so per-user projects don't scale to real usage and reintroduce the "user needs their own backend account" problem we're trying to eliminate for non-developers. The actual risk with a shared project isn't data volume (Postgres handles many tenants fine) — it's table-name collisions between different generated apps.

**Implementation note — plan changed during build:** originally planned a separate Postgres *schema* per project. Dropped that in favor of **table-name prefixing within `public`** (e.g. `habit_tracker__habits` instead of `habits`), because Supabase's REST API (what the generated app's client actually talks to) only exposes schemas explicitly listed in the project's "Exposed schemas" setting — using real per-project schemas would need that admin config automated too (a second credential/API, more moving parts) for no real benefit at this scale. Table prefixing gets the same collision-safety with zero extra Supabase configuration. Revisit real schema separation only if the number of generated apps grows large enough that a flat `public` namespace becomes unwieldy.

**Result:** `generate.js` now also connects directly to Postgres (via `DATABASE_URL`, a Supabase connection-pooler URI — the direct `db.<ref>.supabase.co` host failed to resolve from this network, pooler host `aws-0-<region>.pooler.supabase.com:6543` worked) and runs the generated (now prefixed) SQL automatically, right after writing files and before build validation. No more manual copy-paste into the Supabase SQL editor. Verified end-to-end: generated a new Habit Tracker app, schema was applied automatically, and the app worked correctly in the browser (login, add/toggle/delete) with zero manual SQL steps.

**Known simplification carried into V0.1 (accepted, not solved):** Supabase Auth (`auth.users`) is still shared across every generated app in the project, so the same login credentials technically work across unrelated generated apps. Data itself stays isolated (prefixed tables + RLS), so this isn't a security hole, just a conceptual rough edge. Revisit per-app auth isolation in a later version if it matters once there's real usage — not a V0.1 blocker. The intended working pattern going forward: each version takes on one big deferred problem as its theme (this is the "per-app auth isolation" candidate for a future version) rather than V0.1 trying to solve everything at once.

## M5. Multi-Project Infra + Product Flow
Session-based container orchestration for concurrent users/projects. Wire a minimal web platform UI: login, project creation, chat input, preview display, APK download button.

**Goal:** the full V0.1 user journey (README Section 25 definition of success, generation-only scope) works as a usable product, not just a backend pipeline.

**Platform web app stack decision:** Next.js (chosen 2026-10-09) — the existing Node-based generator scripts can be absorbed as backend API routes directly, and chat/preview UI stays in the same React ecosystem.

**UX decision: APK build is a separate, explicit step, not bundled into generation.** Flow is: describe app -> questions -> generate -> in-platform preview -> user reviews (V0.1 has no modification/fix-up loop yet, so "not satisfied" currently means starting over, a known limitation already tracked under V0.2) -> only once satisfied, user clicks "Download APK" -> that triggers the build. Rationale: EAS Build has limited free quota and takes several minutes; building on every generation attempt would waste both for no benefit, since nothing is shown to the user until they explicitly ask for it.

### 5-1. Automate APK building for any generated app — DONE (2026-10-10)
Manually proved in this session that `app-template` can be built to a real, installable APK via EAS Build (using a dedicated Expo "robot" service-account token, `EXPO_TOKEN` — the same "platform owns one shared account, end users never see it" pattern used for Supabase). Found and fixed one real bug while doing this: `app-template`'s `TextInput`s had no explicit `color`/`backgroundColor`, so in dark mode (background black, default text color black) typed text was invisible — fixed by theming them via `useTheme()`, same as `ThemedText`/`ThemedView` already did. Fixed in the scaffold, so every future generation inherits it automatically.

`generator/build-apk.js <slug>` then automates the whole thing for any already-generated project: sets a per-app Android package name (`com.appbuilder.<slug>`), copies `eas.json`, links an EAS project (`eas init`), pushes the app's Supabase URL/key into EAS environment variables, triggers the build, and polls until an APK URL comes back. Verified end-to-end on the Shopping List app (freshly regenerated, picking up the dark-mode fix too): fully automated run produced a working APK, installed and confirmed functional on a physical device.

**Two real infrastructure bugs found and fixed along the way (not just "config"):**
1. **Generated projects can't live inside the platform's own git repo.** `generator/generated-projects/` had been `.gitignore`'d (since generated output is disposable/regenerable — see M4 notes). EAS Build detects it's inside a git repo and uses `.gitignore` to decide what to upload, so it silently excluded the entire generated project, causing `package.json does not exist` on the remote builder. Tried `.easignore` (which is supposed to override `.gitignore` for EAS specifically) — did not fix it. **Real fix:** moved generated projects fully outside the repo, to a sibling directory (`app-builder-generated-projects/`, path configurable via `GENERATED_PROJECTS_DIR`). This is also the architecturally correct call independent of the bug: user-generated content shouldn't live inside the platform's own source tree at all.
2. **EAS Build requires every project to be its own git repository** (it uses git to compute a build fingerprint) — unrelated to the platform repo. `build-apk.js` now runs a throwaway local `git init` + commit inside each generated project before calling `eas build`.

---

## Deferred (not part of V0.1)

- **Freeform (non-template) generation** — candidate for right after V0.1 proves the template path end-to-end. Direction agreed (safety net via build validation + git-based snapshot/rollback) but implementation deferred.
- **Post-generation modification/maintenance** — V0.2. Design direction (structured spec diff, optimistic preview + background validation, auto-rollback on failure) already discussed; not built in V0.1.
- **iOS builds, app store submission, hosted infra provisioning** — later versions, not yet scoped.
- **AI model routing by task complexity** — route simple/deterministic steps to cheaper models and reserve frontier models for complex generation/architecture/debugging, to control token cost as usage grows. Not needed while proving the end-to-end loop works (M1-M5); V0.1 can call a single frontier model everywhere. Revisit once the pipeline is stable and real usage/cost data exists to inform the routing rules.
