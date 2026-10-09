MVP V0.1

App Develop SAAS

## 1. Overview
This platform make user able to develop mobile app without any Coding knowledge.
Not only this platform make app but also it maintence and deploy the result.

## 2. Problem
These days the vibe coding is booming and lots of developer and non-devloper is jump into coding.
But without coding knowledge, it is really hard to make complex and perfect app or program.
Lots of coding AIs are good at making Frontend and Backend but not really good at connecting both.
Also these AIs are not able to make cloud backend. If there is no cloud backend, you can't deploy it on online.
But non-devlopers don't know how to make this kind of things.
So this SAAS help them to build App without any of this knowledge or skills.

## 3. Goals
1. Make sure users are able to build app without any coding knowledge or skills.
2. Not only do this platform make Frontend and Backend code, they also connect both of them and build infrastructure.
3. This platform can able to maintance the result app.
4. The deployment must be really comfortable and easy.
5. Non-developers friendly UI/UX.

## 4. Mvp Scope

### In Scope (V0.1)
1. Natural-language app description input.
2. Requirement analysis with follow-up clarification questions when the request is insufficient.
3. Structured application specification (screens, data models, features) generated from the clarified request.
4. Template-based app generation: a fixed React Native (Expo) + Supabase scaffold (navigation, auth, data layer) with AI filling in app-specific screens/data models into that scaffold.
5. Build validation after generation (the generated project must actually build before being shown to the user).
6. In-browser live preview via Expo Web (react-native-web), rendered inside the platform immediately after generation — no device/QR step required for the default flow.
7. One-click APK build via EAS Build, downloadable by the user.

### Out of Scope (V0.1 — deferred to later versions)
1. Post-generation modification/maintenance (editing an already-generated app via follow-up natural-language requests). The full generation loop must work first; modification is V0.2+.
2. Freeform (non-template) generation for app types outside the template's coverage. V0.1 proves the template path end-to-end first.
3. iOS builds.
4. App store submission (Play Store / App Store review and publishing).
5. Automatic cloud infrastructure provisioning for running/hosting the deployed app (beyond producing an installable APK).
6. Support for arbitrary frontend/backend frameworks — V0.1 is constrained to a single fixed stack.

## 5. User Flow
1. User logins to web platform.
2. User makes project.
3. User types the prompt about app which he wants to make.
4. The system analying the request.
5. If the system thinks the request is not enough it asks more details.
6. The system builds the app.
7. If the user wants to add more function, then system will check and add it if it possible.
8. Deploy by one-click.
9. Maintence.


## 6. System Architecture

### Generated App Stack (fixed for V0.1)
- Frontend: React Native via Expo
- Backend/DB: Supabase (Postgres, Auth, Row Level Security for per-project data isolation)

### Platform Web App Stack
- The platform itself (login, project creation, chat, preview, download) is built with **Next.js** — chosen so the existing Node-based generator scripts can be absorbed directly as backend API routes, and the preview/chat UI stays in the same React ecosystem.

### Pipeline
```
User prompt
  -> Requirement Analyzer (asks clarifying questions if needed)
  -> Structured Spec (screens, data models, features)
  -> Template Generator (AI fills app-specific slots into the fixed Expo+Supabase scaffold)
  -> Build Validation (project must build successfully)
  -> In-browser Preview (Expo Web / react-native-web, rendered in the platform)
  -> [user reviews preview; APK build is NOT automatic here]
  -> User clicks "Download APK" -> EAS Build triggered on demand -> user downloads APK
```
APK building is a deliberately separate, explicit step (not bundled into every generation) so EAS Build minutes/quota aren't spent until the user is actually satisfied with the preview.

### Storage & Execution
- Each generated project is stored as its own Git repository (also the basis for the snapshot/rollback safety net planned for the modification feature in a later version).
- Preview runs in an ephemeral, per-session container running the Expo dev server; the container is torn down after the session ends. No persistent per-project infrastructure is kept running for V0.1.
- Real-device verification (Expo Go + QR) is available as a secondary/optional check, not the default preview path.

### Known Risk Areas
- Modification safety (preserving existing functionality while applying follow-up changes) is deferred to V0.2, but the git-based storage and build-validation approach are chosen specifically so that work can build on this foundation later.
- Native-device-only behavior may not be fully represented in the Expo Web preview; APK installation remains the final verification step before considering a generation "done."
