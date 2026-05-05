

Now I have full context on the existing project. It is a fresh Next.js 16.2.3 scaffold with React 19, Tailwind CSS 4, and pnpm. No Supabase, no additional dependencies, no routes beyond the default page. Let me build the complete roadmap.

---

# Implementation Plan: Flex Sales Coach

## Overview

Flex Sales Coach is an AI-powered sales coaching platform for door-to-door teams. Reps record conversations on mobile, audio is transcribed via Deepgram with speaker diarization, Claude analyzes objection handling and performance, and managers coach from a rich dashboard. The system is a Next.js 16 web dashboard plus a React Native/Expo mobile app, backed by Supabase and deployed on Vercel.

## Current State

The project at `/Users/jalenbrown/Projects/flex-sales-coach` is a stock Next.js 16.2.3 scaffold:
- React 19.2.4, Tailwind CSS 4, pnpm workspaces
- No Supabase client, no auth, no routes, no components beyond the default page
- `pnpm-workspace.yaml` exists but defines no packages yet -- ready for monorepo structure

---

## Architecture Overview

```
flex-sales-coach/
├── apps/
│   ├── web/                    # Next.js 16 dashboard (current src/ moves here)
│   └── mobile/                 # React Native / Expo app for reps
├── packages/
│   ├── shared/                 # Shared types, constants, validation schemas
│   └── supabase/               # Supabase client, migrations, types
├── supabase/
│   └── migrations/             # SQL migration files
└── pnpm-workspace.yaml
```

**Decision: monorepo vs flat.** Given the mobile app shares types, validation schemas, and Supabase client with the web app, a pnpm workspace monorepo is the right call. The existing `pnpm-workspace.yaml` already supports this.

---

## Database Schema (Supabase)

Six core tables plus Supabase Auth for identity:

| Table | Purpose |
|-------|---------|
| `profiles` | Extends auth.users with role (rep/manager), display name, avatar |
| `teams` | Team grouping for manager-to-rep relationships |
| `calls` | One row per recorded call: audio URL, duration, status, rep_id |
| `transcripts` | Full transcript JSON per call, plus diarized segments |
| `transcript_sections` | Auto-sectioned logical parts of a transcript |
| `analyses` | Claude AI analysis output: scores, objections, insights |
| `tags` | User-defined tags (polymorphic: apply to calls or sections) |
| `call_tags` | Join table: calls <-> tags |
| `section_tags` | Join table: sections <-> tags |
| `audio_notes` | Manager audio recordings attached to a call |
| `objections` | Extracted objections with handling grade and context |

---

## Implementation Phases

### Phase 1: Project Foundation + Supabase Schema + Auth

**Complexity: Large**
**Dependencies: None (starting point)**
**Estimated time: 2-3 days**

This phase transforms the stock scaffold into a working monorepo with auth, database schema, and the Supabase integration layer.

#### Step 1.1: Restructure to Monorepo

- **Action**: Move current `src/` into `apps/web/`, create `packages/shared/` and `packages/supabase/`
- **Files to create/modify**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/pnpm-workspace.yaml` -- update to define `apps/*` and `packages/*`
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/package.json` -- move existing package.json, rename to `@flex/web`
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/next.config.ts` -- move existing
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/tsconfig.json` -- move existing, add path aliases for `@flex/shared` and `@flex/supabase`
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/` -- move existing `src/`
  - `/Users/jalenbrown/Projects/flex-sales-coach/packages/shared/package.json` -- name `@flex/shared`, exports types and schemas
  - `/Users/jalenbrown/Projects/flex-sales-coach/packages/shared/tsconfig.json`
  - `/Users/jalenbrown/Projects/flex-sales-coach/packages/shared/src/index.ts`
  - `/Users/jalenbrown/Projects/flex-sales-coach/packages/supabase/package.json` -- name `@flex/supabase`
  - `/Users/jalenbrown/Projects/flex-sales-coach/packages/supabase/tsconfig.json`
  - `/Users/jalenbrown/Projects/flex-sales-coach/packages/supabase/src/index.ts`
- **Risk**: Medium -- monorepo wiring with Next.js 16 requires `transpilePackages` in next.config.ts

#### Step 1.2: Supabase Project Setup + Migrations

- **Action**: Initialize Supabase locally, create migration files for all core tables
- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/supabase/config.toml` -- local dev config
  - `/Users/jalenbrown/Projects/flex-sales-coach/supabase/migrations/001_profiles.sql`
    - Creates `profiles` table with `id` (FK to auth.users), `role` (enum: 'rep', 'manager'), `full_name`, `avatar_url`, `team_id`, timestamps
    - RLS: users can read own profile, managers can read all profiles in their team
    - Trigger: auto-create profile on auth.users insert
  - `/Users/jalenbrown/Projects/flex-sales-coach/supabase/migrations/002_teams.sql`
    - Creates `teams` table with `id`, `name`, `created_by` (manager), timestamps
    - RLS: team members can read, managers can CRUD
  - `/Users/jalenbrown/Projects/flex-sales-coach/supabase/migrations/003_calls.sql`
    - Creates `calls` table: `id`, `rep_id` (FK profiles), `team_id`, `audio_url`, `duration_seconds`, `status` (enum: 'uploading', 'uploaded', 'transcribing', 'transcribed', 'analyzing', 'complete', 'failed'), `customer_name`, `customer_address`, `recorded_at`, timestamps
    - RLS: reps see own calls, managers see team calls
  - `/Users/jalenbrown/Projects/flex-sales-coach/supabase/migrations/004_transcripts.sql`
    - Creates `transcripts`: `id`, `call_id` (FK), `raw_text`, `diarized_segments` (JSONB array of `{speaker, text, start, end}`), `word_count`, timestamps
    - Creates `transcript_sections`: `id`, `transcript_id` (FK), `title`, `section_type` (enum: 'greeting', 'pitch', 'objection', 'negotiation', 'close', 'other'), `start_index`, `end_index`, `content`, `order_index`
  - `/Users/jalenbrown/Projects/flex-sales-coach/supabase/migrations/005_analyses.sql`
    - Creates `analyses`: `id`, `call_id` (FK), `overall_score` (0-100), `objection_handling_score`, `rapport_score`, `closing_score`, `summary`, `strengths` (JSONB array), `improvements` (JSONB array), `model_version`, timestamps
    - Creates `objections`: `id`, `analysis_id` (FK), `call_id` (FK), `objection_text`, `rep_response`, `handling_grade` (A-F), `suggested_response`, `section_id` (FK nullable), timestamps
  - `/Users/jalenbrown/Projects/flex-sales-coach/supabase/migrations/006_tags_and_notes.sql`
    - Creates `tags`: `id`, `name`, `color`, `team_id`, `created_by`
    - Creates `call_tags`: `call_id`, `tag_id` (composite PK)
    - Creates `section_tags`: `section_id`, `tag_id` (composite PK)
    - Creates `audio_notes`: `id`, `call_id` (FK), `author_id` (FK profiles), `audio_url`, `duration_seconds`, `transcript_text` (optional), `timestamp_ref` (nullable, links to a point in the call), timestamps
  - `/Users/jalenbrown/Projects/flex-sales-coach/supabase/migrations/007_storage_buckets.sql`
    - Creates storage buckets: `call-recordings` (private), `audio-notes` (private)
    - Storage policies: reps upload to `call-recordings/{user_id}/*`, managers upload to `audio-notes/{user_id}/*`, managers can read all in team
- **Risk**: Low -- standard Supabase migration patterns

#### Step 1.3: Supabase Client + Generated Types

- **Action**: Set up typed Supabase client for server and browser contexts
- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/packages/supabase/src/client.ts` -- `createBrowserClient()` using `@supabase/ssr`
  - `/Users/jalenbrown/Projects/flex-sales-coach/packages/supabase/src/server.ts` -- `createServerClient()` for Next.js server components and route handlers, uses cookies
  - `/Users/jalenbrown/Projects/flex-sales-coach/packages/supabase/src/admin.ts` -- `createAdminClient()` with service role key for background jobs
  - `/Users/jalenbrown/Projects/flex-sales-coach/packages/supabase/src/types.ts` -- generated via `supabase gen types typescript` (add to package.json scripts)
  - `/Users/jalenbrown/Projects/flex-sales-coach/packages/supabase/src/index.ts` -- barrel export
- **Dependencies**: Step 1.2 (needs schema for type generation)
- **npm packages to install in `packages/supabase`**: `@supabase/supabase-js`, `@supabase/ssr`

#### Step 1.4: Auth Flow (Supabase Auth)

- **Action**: Implement email/password auth with role selection, protected routes via middleware
- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/(auth)/login/page.tsx` -- login form (email + password)
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/(auth)/signup/page.tsx` -- signup with role selection (rep or manager) and team join/create
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/(auth)/layout.tsx` -- centered auth layout, no sidebar
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/auth/callback/route.ts` -- OAuth/magic link callback handler
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/auth/confirm/route.ts` -- email confirmation handler
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/middleware.ts` -- (Note: Next.js 16 renames this to `proxy.ts` if using the new convention; verify docs) protect all routes except `/(auth)/*` and `/auth/*`, redirect unauthenticated users to `/login`
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/lib/auth.ts` -- `getUser()` helper for server components, `requireAuth()` that throws redirect, `requireManager()` role guard
- **Dependencies**: Steps 1.1, 1.3
- **Risk**: Medium -- Next.js 16 middleware/proxy naming must be verified against current docs
- **npm packages to install in `apps/web`**: `@supabase/supabase-js`, `@supabase/ssr`

#### Step 1.5: Environment Configuration

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/.env.local.example` -- template with all required vars
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/lib/env.ts` -- runtime validation of env vars using Zod, fail-fast at startup
- **Required env vars**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `INTERNAL_API_SECRET`, `CRON_SECRET`
- **Optional platform admin env var**: `PLATFORM_ADMIN_EMAILS` -- comma-separated emails allowed to create isolated customer teams
- **npm packages**: `zod`

#### Step 1.6: Shared Types + Validation Schemas

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/packages/shared/src/types/user.ts` -- `UserRole`, `Profile`, `Team` types
  - `/Users/jalenbrown/Projects/flex-sales-coach/packages/shared/src/types/call.ts` -- `Call`, `CallStatus`, `DiarizedSegment` types
  - `/Users/jalenbrown/Projects/flex-sales-coach/packages/shared/src/types/transcript.ts` -- `Transcript`, `TranscriptSection`, `SectionType` types
  - `/Users/jalenbrown/Projects/flex-sales-coach/packages/shared/src/types/analysis.ts` -- `Analysis`, `Objection`, `HandlingGrade` types
  - `/Users/jalenbrown/Projects/flex-sales-coach/packages/shared/src/types/tag.ts` -- `Tag`, `AudioNote` types
  - `/Users/jalenbrown/Projects/flex-sales-coach/packages/shared/src/types/index.ts` -- barrel export
  - `/Users/jalenbrown/Projects/flex-sales-coach/packages/shared/src/schemas/call.ts` -- Zod schemas for call creation, validation
  - `/Users/jalenbrown/Projects/flex-sales-coach/packages/shared/src/schemas/tag.ts` -- Zod schemas for tag CRUD
  - `/Users/jalenbrown/Projects/flex-sales-coach/packages/shared/src/constants.ts` -- `CALL_STATUSES`, `SECTION_TYPES`, `MAX_AUDIO_DURATION_SECONDS`, `MAX_UPLOAD_SIZE_BYTES`

#### Definition of Done - Phase 1
- [ ] `pnpm install` succeeds across all workspace packages
- [ ] `pnpm --filter @flex/web build` produces a working Next.js build
- [ ] Supabase local dev starts with `supabase start`, all migrations apply cleanly
- [ ] Navigating to `/login` shows auth form, `/signup` shows registration
- [ ] Signing up creates a user in auth.users and a row in profiles
- [ ] Authenticated users are redirected from `/login` to `/dashboard`
- [ ] Unauthenticated users are redirected from `/dashboard` to `/login`
- [ ] Manager and rep roles are distinguished in the profiles table

---

### Phase 2: Dashboard Layout + Rep Management

**Complexity: Medium**
**Dependencies: Phase 1 complete**
**Estimated time: 2 days**

#### Step 2.1: UI Component Library Foundation

- **Action**: Install and configure base UI primitives. Use Radix UI primitives for accessibility, style with Tailwind.
- **npm packages for `apps/web`**: `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-avatar`, `@radix-ui/react-tabs`, `@radix-ui/react-tooltip`, `@radix-ui/react-select`, `@radix-ui/react-popover`, `clsx`, `tailwind-merge`, `lucide-react`
- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/lib/cn.ts` -- `cn()` utility combining `clsx` + `tailwind-merge`
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/ui/Button.tsx` -- primary, secondary, ghost, danger variants; sizes sm/md/lg
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/ui/Badge.tsx` -- colored badges for statuses and tags
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/ui/Avatar.tsx` -- wraps Radix Avatar with initials fallback
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/ui/Card.tsx` -- surface card with intentional depth/shadow
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/ui/Input.tsx` -- text input with label, error state
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/ui/Select.tsx` -- wraps Radix Select
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/ui/Skeleton.tsx` -- loading skeleton primitives
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/ui/EmptyState.tsx` -- illustrated empty states
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/ui/ScoreRing.tsx` -- circular progress indicator for scores (0-100), animated with CSS `conic-gradient` + `clip-path`

#### Step 2.2: Design Tokens + Typography

- **Action**: Establish visual identity. Direction: dark professional with warm accent -- think "premium coaching tool", not "generic SaaS template". Deep slate backgrounds, warm amber/gold accents, strong type hierarchy.
- **Files to modify**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/globals.css` -- replace default styles with design tokens:
    - `--color-surface-*` (3 depth levels), `--color-accent-*` (amber/gold scale), `--color-success/warning/danger`
    - Typography scale using `clamp()` for fluid sizing
    - Custom `--ease-*` curves for motion
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/layout.tsx` -- update fonts (Inter for body, a display face for headings), update metadata

#### Step 2.3: Dashboard Shell Layout

- **Action**: Create the authenticated app shell with sidebar navigation and top bar
- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/(dashboard)/layout.tsx` -- server component layout, fetches user profile, passes to client shell
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/shell/AppShell.tsx` -- client component: sidebar + main content area, responsive (collapsed sidebar on mobile)
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/shell/Sidebar.tsx` -- navigation links with icons, role-conditional items (managers see "Team" and "Analytics", reps see "My Calls")
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/shell/TopBar.tsx` -- breadcrumbs, user avatar dropdown (profile, sign out)
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/shell/SidebarLink.tsx` -- active state detection via `usePathname()`
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/shell/UserMenu.tsx` -- Radix dropdown: profile link, sign out action
- **Navigation structure** (role-dependent):
  - Manager: Dashboard, Team, All Calls, Analytics, Tags
  - Rep: My Calls, My Stats

#### Step 2.4: Dashboard Home Page

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/(dashboard)/dashboard/page.tsx` -- server component, fetches summary data
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/dashboard/DashboardStats.tsx` -- key metrics: total calls this week, average score, top objection, calls needing review
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/dashboard/RecentCallsList.tsx` -- last 5 calls with status badges, scores, rep names
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/dashboard/TeamLeaderboard.tsx` -- ranked rep list by average score (manager view only)

#### Step 2.5: Team + Rep Management (Manager Only)

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/(dashboard)/team/page.tsx` -- list team members with stats
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/(dashboard)/team/invite/page.tsx` -- invite form (generates invite link or sends email)
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/team/RepCard.tsx` -- rep avatar, name, call count, avg score, last active
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/team/InviteForm.tsx` -- client component form
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/(dashboard)/team/[repId]/page.tsx` -- individual rep profile with their call history and performance trend
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/lib/actions/team.ts` -- server actions: `inviteRepAction`, `removeRepAction`, `updateRepRoleAction`

#### Definition of Done - Phase 2
- [ ] Authenticated users see the dashboard shell with sidebar navigation
- [ ] Manager sees team management, rep sees personal dashboard
- [ ] Dashboard displays placeholder stats (real data comes later)
- [ ] Team page lists members with invite functionality
- [ ] Navigation highlights active route
- [ ] Layout is responsive at 320px, 768px, 1024px, 1440px
- [ ] No horizontal overflow at any breakpoint

---

### Phase 3: Audio Upload + Storage Pipeline

**Complexity: Medium**
**Dependencies: Phase 1 (auth, storage buckets, call table)**
**Estimated time: 1-2 days**

#### Step 3.1: Upload API Route

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/api/calls/upload/route.ts`
    - POST handler: validates auth, accepts multipart form data (audio file + metadata)
    - Validates file type (audio/webm, audio/mp4, audio/mpeg, audio/wav), max size (100MB)
    - Uploads to Supabase Storage `call-recordings/{userId}/{callId}.{ext}`
    - Creates `calls` row with status `'uploaded'`
    - Returns call ID for status polling
    - Uses streaming upload to avoid memory issues with large files
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/lib/actions/calls.ts` -- server actions: `createCallAction` (metadata only), `deleteCallAction`, `updateCallMetadataAction`
- **Risk**: Medium -- large file uploads on Vercel have a payload limit (4.5MB on hobby, 50MB on Pro for serverless; use Supabase Storage direct upload for production)

#### Step 3.2: Direct Upload to Supabase Storage (Mobile Path)

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/api/calls/presign/route.ts`
    - POST handler: generates a signed upload URL for Supabase Storage
    - Mobile app uploads directly to storage, bypassing Vercel payload limits
    - Returns `{ uploadUrl, callId, storagePath }`
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/api/calls/confirm/route.ts`
    - POST handler: called after direct upload completes
    - Verifies file exists in storage, updates call status to `'uploaded'`
    - Triggers transcription pipeline (Phase 4)

#### Step 3.3: Calls List Page

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/(dashboard)/calls/page.tsx` -- server component, paginated call list with filters
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/calls/CallsTable.tsx` -- table with columns: date, rep, customer, duration, status, score, tags
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/calls/CallFilters.tsx` -- client component: filter by rep, date range, status, score range, tag; state persisted in URL search params
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/calls/CallStatusBadge.tsx` -- colored badge per call status
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/calls/CallRow.tsx` -- table row with hover state, click navigates to detail
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/lib/queries/calls.ts` -- `fetchCalls(filters, pagination)`, `fetchCallById(id)` data access functions

#### Step 3.4: Upload UI (Web Fallback)

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/(dashboard)/calls/upload/page.tsx` -- upload page for web (drag-and-drop + file picker)
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/calls/UploadDropzone.tsx` -- client component: drag-drop area, file validation, upload progress bar, metadata form (customer name, address, notes)

#### Definition of Done - Phase 3
- [ ] Audio file can be uploaded via web UI and stored in Supabase Storage
- [ ] Presigned URL flow works for direct uploads
- [ ] Call record is created in database with status tracking
- [ ] Calls list page shows all calls with working filters
- [ ] Filter state persists in URL (shareable, back-button works)
- [ ] Upload rejects invalid file types and oversized files with clear error messages

---

### Phase 4: Transcription Integration (Deepgram)

**Complexity: Large**
**Dependencies: Phase 3 (uploaded audio in storage)**
**Estimated time: 2 days**

#### Step 4.1: Deepgram Service Layer

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/lib/services/deepgram.ts`
    - `transcribeAudio(audioUrl: string): Promise<DeepgramResponse>` -- calls Deepgram pre-recorded API with diarization enabled
    - Configuration: model `nova-2`, language `en`, diarize `true`, punctuate `true`, paragraphs `true`, utterances `true`, smart_format `true`
    - Parses response into `DiarizedSegment[]` format: `{ speaker: number, text: string, startMs: number, endMs: number, confidence: number }`
    - Handles Deepgram error responses with structured error types
  - `/Users/jalenbrown/Projects/flex-sales-coach/packages/shared/src/types/deepgram.ts` -- `DeepgramResponse`, `DeepgramWord`, `DeepgramUtterance` types
- **npm packages for `apps/web`**: `@deepgram/sdk`

#### Step 4.2: Transcription Pipeline

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/lib/services/transcription-pipeline.ts`
    - `runTranscriptionPipeline(callId: string): Promise<void>`
    - Steps: (1) fetch audio URL from call record, (2) download signed URL from Supabase Storage, (3) send to Deepgram, (4) parse diarized segments, (5) store transcript, (6) auto-section transcript, (7) update call status
    - Error handling: updates call status to `'failed'` with error message on failure
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/lib/services/transcript-sectioner.ts`
    - `sectionTranscript(segments: DiarizedSegment[]): TranscriptSection[]`
    - Uses heuristics + Claude API (lightweight call) to identify logical sections:
      - Greeting/introduction (first ~30 seconds)
      - Product pitch
      - Objection handling (speaker switches with negative sentiment cues)
      - Negotiation
      - Close/wrap-up
    - Falls back to time-based sectioning if AI sectioning fails

#### Step 4.3: Transcription Trigger Route

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/api/calls/[callId]/transcribe/route.ts`
    - POST handler: validates auth (must be call owner or manager), checks call status is `'uploaded'`
    - Updates status to `'transcribing'`
    - Runs transcription pipeline
    - In production, this should be a background job (Vercel Cron or Supabase Edge Function) to avoid serverless timeout. For MVP, run inline with extended timeout config.
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/api/calls/[callId]/status/route.ts`
    - GET handler: returns current call status for polling

#### Step 4.4: Auto-Trigger on Upload Confirmation

- **Files to modify**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/api/calls/confirm/route.ts` -- after confirming upload, trigger transcription pipeline automatically
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/api/calls/upload/route.ts` -- after successful upload, trigger transcription

#### Definition of Done - Phase 4
- [ ] Uploading audio automatically triggers Deepgram transcription
- [ ] Transcript is stored with diarized speaker segments
- [ ] Transcript is auto-sectioned into logical parts
- [ ] Call status progresses: uploaded -> transcribing -> transcribed
- [ ] Failed transcriptions update status to 'failed' with error context
- [ ] Status polling endpoint works for UI progress display

---

### Phase 5: AI Analysis Pipeline (Claude API)

**Complexity: Large**
**Dependencies: Phase 4 (transcripts exist)**
**Estimated time: 2-3 days**

#### Step 5.1: Claude Analysis Service

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/lib/services/claude-analysis.ts`
    - `analyzeCall(transcript: Transcript, sections: TranscriptSection[]): Promise<AnalysisResult>`
    - Sends structured prompt to Claude with:
      - Full transcript with speaker labels
      - Section boundaries
      - Instruction to return JSON with: overall score, sub-scores (objection handling, rapport, closing technique), identified objections with grades, strengths array, improvements array, summary
    - Uses `response_format` or structured output prompting for reliable JSON
    - Model: `claude-sonnet-4-20250514` for cost efficiency on high-volume analysis
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/lib/services/claude-prompts.ts`
    - `CALL_ANALYSIS_SYSTEM_PROMPT` -- detailed system prompt defining scoring rubric, objection categories, grading criteria
    - `buildAnalysisUserPrompt(transcript, sections)` -- formats transcript for analysis
    - `OBJECTION_GRADING_RUBRIC` -- A (excellent) through F (failed) definitions
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/lib/services/analysis-parser.ts`
    - `parseAnalysisResponse(raw: string): AnalysisResult` -- validates and parses Claude's JSON response with Zod schema validation
    - Handles malformed responses gracefully
- **npm packages for `apps/web`**: `@anthropic-ai/sdk`

#### Step 5.2: Analysis Pipeline

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/lib/services/analysis-pipeline.ts`
    - `runAnalysisPipeline(callId: string): Promise<void>`
    - Steps: (1) fetch transcript and sections, (2) send to Claude, (3) parse response, (4) store analysis, (5) store individual objections, (6) update call status to `'complete'`
    - Retry logic: up to 3 retries with exponential backoff on transient Claude API errors
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/api/calls/[callId]/analyze/route.ts`
    - POST handler: triggers analysis on a transcribed call
    - Guards: must be `'transcribed'` status

#### Step 5.3: Chain Transcription -> Analysis

- **Files to modify**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/lib/services/transcription-pipeline.ts` -- after successful transcription, automatically trigger analysis pipeline
- **Full pipeline flow**: upload -> transcribe (Deepgram) -> section -> analyze (Claude) -> complete

#### Step 5.4: Background Job Strategy

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/api/cron/process-calls/route.ts`
    - GET handler (Vercel Cron): picks up calls stuck in `'uploaded'` or `'transcribed'` status and re-processes them
    - Handles the case where inline processing timed out
    - Config: `export const maxDuration = 300` (5 min for Pro plan)
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/vercel.json` -- cron schedule: every 5 minutes
- **Risk**: High -- Vercel serverless functions have a 10-second timeout on hobby plan, 300 seconds on Pro. Long audio files may exceed this. Mitigation: (1) use Vercel Pro, (2) implement chunked processing, (3) consider Supabase Edge Functions for heavy lifting

#### Definition of Done - Phase 5
- [ ] Transcribed calls are automatically analyzed by Claude
- [ ] Analysis includes overall score, sub-scores, objections, strengths, improvements
- [ ] Each objection is stored with the rep's response and a handling grade
- [ ] Call status progresses through the full pipeline: uploaded -> transcribing -> transcribed -> analyzing -> complete
- [ ] Failed analyses are retried by cron job
- [ ] Analysis results match the Zod schema consistently

---

### Phase 6: Call Detail View with Sectioned Transcripts + AI Insights

**Complexity: Large**
**Dependencies: Phases 4 + 5 (transcripts and analyses exist)**
**Estimated time: 2-3 days**

This is the core user-facing feature -- where managers spend most of their time.

#### Step 6.1: Call Detail Page

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/(dashboard)/calls/[callId]/page.tsx`
    - Server component: fetches call, transcript, sections, analysis, objections, tags, audio notes
    - Parallel data fetching with `Promise.all` to avoid waterfall
    - 404 if call not found, 403 if user lacks access
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/(dashboard)/calls/[callId]/loading.tsx` -- skeleton UI matching the detail layout
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/lib/queries/call-detail.ts` -- `fetchCallDetail(callId)` returns all related data in one round trip (joins)

#### Step 6.2: Audio Player

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/call-detail/AudioPlayer.tsx`
    - Client component: custom audio player with waveform visualization
    - Playback controls: play/pause, seek, speed (0.5x, 1x, 1.25x, 1.5x, 2x), skip 10s forward/back
    - Current timestamp display
    - Click on transcript segment jumps audio to that timestamp
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/call-detail/AudioWaveform.tsx`
    - Canvas-based waveform visualization
    - Highlights current playback position
    - Colored regions for transcript sections
- **npm packages**: `wavesurfer.js` (lightweight, well-maintained waveform library)

#### Step 6.3: Sectioned Transcript View

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/call-detail/TranscriptView.tsx`
    - Client component: scrollable transcript with section headers
    - Each section is collapsible with a section type badge
    - Speaker labels color-coded (rep = blue, customer = neutral)
    - Timestamps on each segment, clickable to seek audio
    - Auto-scrolls to follow audio playback (with "stop following" on user scroll)
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/call-detail/TranscriptSegment.tsx` -- individual speech segment with speaker, timestamp, text
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/call-detail/SectionHeader.tsx` -- section divider with type icon, title, score (if applicable)
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/hooks/useAudioSync.ts` -- custom hook: connects audio player currentTime to transcript scroll position

#### Step 6.4: AI Insights Panel

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/call-detail/InsightsPanel.tsx`
    - Sidebar panel (or tab on mobile) showing analysis results
    - Score rings for overall + sub-scores
    - Strengths list with green checkmarks
    - Improvements list with amber indicators
    - AI summary paragraph
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/call-detail/ObjectionsList.tsx`
    - Lists each detected objection with:
      - Customer's objection text (quoted)
      - Rep's response (quoted)
      - Handling grade (A-F with color coding)
      - AI suggested better response (expandable)
      - Link to the exact transcript section
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/call-detail/ScoreBreakdown.tsx` -- visual breakdown of sub-scores with descriptions

#### Step 6.5: Call Detail Layout Composition

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/call-detail/CallDetailLayout.tsx`
    - Composes: audio player (top, sticky), transcript (left/main), insights panel (right sidebar / bottom on mobile)
    - Two-column layout on desktop, stacked on mobile with tab navigation between transcript and insights
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/call-detail/CallHeader.tsx` -- call metadata: rep name, customer, date, duration, status, overall score

#### Definition of Done - Phase 6
- [ ] Call detail page loads with audio player, transcript, and AI insights
- [ ] Audio player syncs with transcript (clicking segments seeks audio, auto-scroll follows playback)
- [ ] Transcript sections are visually distinct with collapsible headers
- [ ] Speaker diarization is visible (rep vs customer labeled and color-coded)
- [ ] AI scores display in score rings with sub-score breakdown
- [ ] Objections list shows customer text, rep response, grade, and AI suggestion
- [ ] Layout works on 320px through 1440px with no overflow
- [ ] Loading and error states are handled

---

### Phase 7: Objection Tracking + Rep Performance Analytics

**Complexity: Medium**
**Dependencies: Phase 5 (analyses and objections exist)**
**Estimated time: 2 days**

#### Step 7.1: Analytics Data Queries

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/lib/queries/analytics.ts`
    - `fetchTeamAnalytics(teamId, dateRange)` -- aggregated: avg scores, total calls, score trends, top objections
    - `fetchRepAnalytics(repId, dateRange)` -- individual rep: score over time, objection handling improvement, call volume
    - `fetchObjectionAnalytics(teamId, dateRange)` -- most common objections, best/worst handled, by rep
    - `fetchRepComparison(teamId, dateRange)` -- all reps ranked by various metrics

#### Step 7.2: Team Analytics Page (Manager)

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/(dashboard)/analytics/page.tsx` -- server component with date range picker
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/analytics/ScoreTrendChart.tsx` -- line chart: team average score over time
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/analytics/RepComparisonChart.tsx` -- bar chart: reps ranked by score
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/analytics/TopObjections.tsx` -- ranked list of most common objections with handling success rate
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/analytics/CallVolumeChart.tsx` -- calls per day/week
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/analytics/DateRangePicker.tsx` -- presets (this week, this month, last 30 days, custom) stored in URL params
- **npm packages**: `recharts` (lightweight, React-native charting library with good SSR story)

#### Step 7.3: Rep Performance Page

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/(dashboard)/analytics/rep/[repId]/page.tsx` -- individual rep deep dive
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/analytics/RepScoreHistory.tsx` -- score trend for one rep
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/analytics/RepObjectionBreakdown.tsx` -- this rep's objection handling grades over time
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/analytics/RepStrengthsWeaknesses.tsx` -- aggregated from AI analyses

#### Step 7.4: Personal Stats Page (Rep View)

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/(dashboard)/my-stats/page.tsx` -- rep sees own performance, same data as manager rep view but personal framing
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/analytics/PersonalProgress.tsx` -- "your score this week vs last week" hero stat
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/analytics/ImprovementTips.tsx` -- AI-generated coaching tips aggregated from recent analyses

#### Definition of Done - Phase 7
- [ ] Manager analytics page shows team-wide trends, rep comparisons, and objection patterns
- [ ] Individual rep analytics show score history and objection handling improvement
- [ ] Charts render with real data, handle empty states gracefully
- [ ] Date range filtering works via URL params
- [ ] Rep personal stats page shows their own trajectory
- [ ] All charts respect the design system (colors, typography, spacing)

---

### Phase 8: Tagging + Manager Audio Notes

**Complexity: Medium**
**Dependencies: Phase 6 (call detail view exists)**
**Estimated time: 1-2 days**

#### Step 8.1: Tag Management

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/(dashboard)/tags/page.tsx` -- manage team tags (create, edit, delete)
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/tags/TagManager.tsx` -- CRUD interface for tags with color picker
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/tags/TagPicker.tsx` -- reusable popover for selecting/applying tags (used on call detail and section level)
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/tags/TagBadge.tsx` -- colored pill display
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/lib/actions/tags.ts` -- server actions: `createTagAction`, `deleteTagAction`, `addCallTagAction`, `removeCallTagAction`, `addSectionTagAction`, `removeSectionTagAction`

#### Step 8.2: Tag Integration in Call Detail

- **Files to modify**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/call-detail/CallHeader.tsx` -- add tag picker and display
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/call-detail/SectionHeader.tsx` -- add section-level tag picker
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/calls/CallFilters.tsx` -- add tag filter option

#### Step 8.3: Manager Audio Notes

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/call-detail/AudioNotes.tsx`
    - Client component: list of audio notes attached to the call
    - Each note shows: manager avatar, timestamp, audio player, optional transcript
    - Record button to add new note (uses browser MediaRecorder API)
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/components/call-detail/AudioNoteRecorder.tsx`
    - Client component: record audio in browser
    - Start/stop recording, playback preview before saving
    - Optional: reference a specific timestamp in the call ("at 2:34...")
    - Uploads to Supabase Storage `audio-notes/{userId}/{noteId}.webm`
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/hooks/useAudioRecorder.ts`
    - Custom hook wrapping MediaRecorder API
    - Returns: `{ isRecording, startRecording, stopRecording, audioBlob, audioUrl, duration }`
    - Handles permission requests, error states
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/lib/actions/audio-notes.ts` -- server actions: `createAudioNoteAction`, `deleteAudioNoteAction`
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/api/audio-notes/upload/route.ts` -- upload handler for audio note files

#### Definition of Done - Phase 8
- [ ] Tags can be created with custom names and colors
- [ ] Tags can be applied to calls and individual transcript sections
- [ ] Call list filters by tag
- [ ] Manager can record audio notes from browser and attach to calls
- [ ] Audio notes display alongside transcript with playback
- [ ] Notes optionally reference a specific call timestamp
- [ ] Reps can see (but not delete) manager audio notes on their calls

---

### Phase 9: React Native Mobile App for Reps

**Complexity: Large**
**Dependencies: Phase 3 (upload API), Phase 1 (auth)**
**Estimated time: 4-5 days**

This is the field-critical piece -- reps use this on every door knock.

#### Step 9.1: Expo Project Setup

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/` -- Expo project root
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/package.json` -- name `@flex/mobile`, Expo SDK 52+
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/app.json` -- Expo config: app name, permissions (microphone, background audio)
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/tsconfig.json`
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/babel.config.js`
- **npm packages**: `expo`, `expo-router`, `expo-av` (audio recording/playback), `expo-file-system`, `expo-task-manager` (background tasks), `expo-background-fetch`, `@supabase/supabase-js`, `@supabase/ssr`, `react-native-safe-area-context`, `nativewind` (Tailwind for RN)

#### Step 9.2: Mobile Auth

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/src/lib/supabase.ts` -- Supabase client configured for React Native (AsyncStorage for session)
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/src/app/(auth)/login.tsx` -- login screen
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/src/app/(auth)/_layout.tsx` -- auth layout
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/src/app/(app)/_layout.tsx` -- authenticated layout with tab navigation
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/src/providers/AuthProvider.tsx` -- context provider with session management
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/src/hooks/useSession.ts`

#### Step 9.3: Background Audio Recording (Critical Feature)

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/src/lib/audio-recorder.ts`
    - Wraps `expo-av` Audio.Recording
    - Configures for: high quality mono audio, background recording mode
    - Handles iOS/Android permission flows
    - Continues recording when app is backgrounded or screen is off
    - Saves to local file system
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/src/hooks/useRecording.ts`
    - Custom hook: `{ isRecording, startRecording, stopRecording, pauseRecording, duration, filePath }`
    - Persists recording state across app lifecycle
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/src/lib/background-task.ts`
    - Registers background task via `expo-task-manager` to keep recording alive
    - Handles iOS audio session configuration for background recording
- **Risk**: High -- background audio on iOS is tricky. Requires `audio` background mode in `Info.plist` (set via `app.json` `ios.infoPlist`). Android is more permissive but needs foreground service notification. This must be tested on physical devices.

#### Step 9.4: Recording Screen

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/src/app/(app)/record.tsx`
    - Main recording screen: large record button, timer display, waveform animation
    - Metadata input: customer name, address (optional, can add later)
    - "Recording active" persistent indicator
    - Stop button triggers upload flow
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/src/components/RecordButton.tsx` -- animated record/stop button with pulse animation
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/src/components/RecordingTimer.tsx` -- elapsed time display
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/src/components/RecordingIndicator.tsx` -- persistent indicator showing active recording (shown across all screens)

#### Step 9.5: Upload + Sync

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/src/lib/upload-manager.ts`
    - Manages upload queue: if offline, queues locally, retries when connectivity returns
    - Calls presign endpoint, uploads directly to Supabase Storage
    - Calls confirm endpoint after upload
    - Shows upload progress notification
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/src/hooks/useUploadQueue.ts` -- exposes pending uploads, upload status, retry capability
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/src/lib/offline-storage.ts` -- SQLite or AsyncStorage-based queue for pending uploads

#### Step 9.6: Call History + Results Screen

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/src/app/(app)/calls/index.tsx` -- list of rep's calls with status and scores
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/src/app/(app)/calls/[callId].tsx` -- call detail: simplified transcript view, scores, objection feedback
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/src/app/(app)/stats.tsx` -- personal stats screen (scores, trends)
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/src/components/CallCard.tsx`
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/mobile/src/components/ScoreBadge.tsx`

#### Definition of Done - Phase 9
- [ ] Rep can sign in on mobile app
- [ ] Recording starts and continues with screen off / app backgrounded
- [ ] Recording uploads automatically when stopped (or queues if offline)
- [ ] Upload queue drains when connectivity is restored
- [ ] Rep can view their call history with statuses
- [ ] Rep can view AI analysis results on completed calls
- [ ] Works on both iOS and Android physical devices
- [ ] Microphone permission flow is clean

---

### Phase 10: Polish + End-to-End Testing

**Complexity: Medium**
**Dependencies: All prior phases**
**Estimated time: 2-3 days**

#### Step 10.1: Error Handling + Edge Cases

- **Files to create/modify**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/(dashboard)/calls/[callId]/error.tsx` -- error boundary for call detail
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/(dashboard)/calls/[callId]/not-found.tsx` -- 404 for invalid call IDs
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/global-error.tsx` -- global error boundary
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/not-found.tsx` -- global 404
  - All API routes: add consistent error response format, rate limiting headers
  - All server actions: add input validation via Zod schemas

#### Step 10.2: Loading States + Optimistic UI

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/(dashboard)/dashboard/loading.tsx`
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/(dashboard)/calls/loading.tsx`
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/app/(dashboard)/analytics/loading.tsx`
  - Optimistic updates for: tag add/remove, audio note creation

#### Step 10.3: Real-Time Status Updates

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/hooks/useCallStatus.ts` -- Supabase Realtime subscription for call status changes (so managers see calls progress through pipeline without refreshing)
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/hooks/useRealtimeTable.ts` -- generic Supabase Realtime hook

#### Step 10.4: E2E Tests (Playwright)

- **Files to create**:
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/playwright.config.ts`
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/e2e/auth.spec.ts` -- login, signup, logout, role-based redirect
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/e2e/calls-list.spec.ts` -- view calls, filter, paginate
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/e2e/call-detail.spec.ts` -- view transcript, play audio, see analysis
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/e2e/analytics.spec.ts` -- view charts, change date range
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/e2e/tags.spec.ts` -- create tag, apply to call, filter by tag
  - `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/e2e/fixtures/seed.ts` -- test data seeding script

#### Step 10.5: Performance Audit

- Verify LCP < 2.5s on dashboard and call detail pages
- Verify JS bundle < 300kb gzipped per page
- Verify no layout shifts (CLS < 0.1)
- Lazy load: charts, waveform library, audio player
- Image optimization for avatars

#### Step 10.6: Security Hardening

- CSP headers in `/Users/jalenbrown/Projects/flex-sales-coach/apps/web/src/middleware.ts`
- Rate limiting on upload and API routes
- Verify RLS policies prevent cross-team data access
- Verify service role key is never exposed to client

#### Definition of Done - Phase 10
- [ ] All error boundaries are in place with helpful messages
- [ ] Loading skeletons exist for every page
- [ ] Real-time status updates work without page refresh
- [ ] E2E tests pass for all critical flows
- [ ] Lighthouse score > 90 on dashboard
- [ ] No security policy gaps (tested with cross-user access attempts)
- [ ] Production build succeeds cleanly

---

## Critical Path

The critical path (longest chain of sequential dependencies) is:

```
Phase 1 (foundation) -> Phase 3 (upload) -> Phase 4 (transcription) -> Phase 5 (analysis) -> Phase 6 (call detail)
```

Everything else branches off this spine. Blocking items within each phase:

1. **Supabase schema** blocks everything
2. **Auth** blocks all authenticated features
3. **Upload pipeline** blocks transcription
4. **Transcription** blocks analysis
5. **Analysis** blocks call detail insights and analytics

## Parallel Execution Opportunities

| Can Run in Parallel | With |
|---------------------|------|
| Phase 2 (dashboard layout + UI components) | Phase 3 (upload pipeline) |
| Phase 7 (analytics) | Phase 8 (tags + audio notes) |
| Phase 9 (mobile app, steps 9.1-9.4: recording) | Phases 6-8 (web features) |
| Phase 10.4 (E2E tests) | Phase 10.5 (performance audit) |

**Recommended two-track approach:**
- **Track A (Web)**: P1 -> P2 + P3 (parallel) -> P4 -> P5 -> P6 -> P7 + P8 (parallel) -> P10
- **Track B (Mobile)**: Start P9 after P1 + P3 are done (needs auth + upload API)

## MVP Cutoff

**Minimum viable product = Phases 1 + 3 + 4 + 5 + 6 + a stripped Phase 2**

With this subset, you can:
- Sign in as manager or rep
- Upload audio from web (or Postman for now)
- Audio is transcribed and analyzed automatically
- View call detail with transcript, sections, and AI coaching feedback
- See a basic call list

**What is deferred past MVP:**
- Analytics/charts (Phase 7)
- Tags and audio notes (Phase 8)
- Mobile app (Phase 9)
- Polish/E2E (Phase 10)

**MVP estimated time: 8-10 days of focused development.**

## Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Vercel serverless timeout on long audio** | High | Use Vercel Pro (300s limit). For audio > 30 min, implement chunked upload to Deepgram or offload to Supabase Edge Function. Add cron job fallback (Phase 5.4). |
| **Background recording on iOS** | High | Requires `audio` background mode. Test on physical device early in Phase 9. Have fallback: "keep app in foreground" guidance if background fails on certain iOS versions. |
| **Deepgram diarization accuracy** | Medium | Diarization quality varies. Allow manual speaker label correction in UI. Consider requiring reps to state "This is [name] starting a call with [customer]" for better speaker separation. |
| **Claude API cost at scale** | Medium | Use Claude Sonnet (not Opus) for per-call analysis. Cache analysis results. At 50 reps x 10 calls/day x ~2K tokens/analysis, estimated ~$15-30/day. Monitor and set budget alerts. |
| **Monorepo complexity** | Low | Keep shared packages minimal. Use TypeScript project references for fast builds. Test `pnpm --filter` commands early. |
| **Audio file sizes (mobile uploads over cellular)** | Medium | Compress audio client-side (mono, 16kHz is sufficient for speech). Show upload progress. Queue and retry on failure. Target < 5MB per 10-minute call with proper compression. |
| **Supabase Storage limits** | Low | Free tier: 1GB storage, 2GB bandwidth. Pro tier: 100GB storage, 200GB bandwidth. Monitor early. At scale, consider S3 with signed URLs. |

## Key Technical Decisions

1. **Monorepo with pnpm workspaces** -- types and validation shared between web and mobile, single source of truth
2. **Server Components for data fetching** -- call list and detail pages are server-rendered, no client-side data fetching libraries needed for primary views
3. **Server Actions for mutations** -- tag operations, audio note creation, call metadata updates all use Next.js server actions with Zod validation
4. **Supabase Realtime for status updates** -- managers see call pipeline progress without polling
5. **URL-as-state for filters** -- all filter/sort/pagination state lives in URL search params, enabling shareable links and browser navigation
6. **Presigned upload for mobile** -- bypasses Vercel payload limits, uploads directly to Supabase Storage
7. **Claude Sonnet for analysis** -- best cost/quality ratio for structured JSON analysis at volume
