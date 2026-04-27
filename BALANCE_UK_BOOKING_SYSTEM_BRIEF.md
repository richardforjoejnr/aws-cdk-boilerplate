# Balance_UK Booking System — Evaluation Brief, POC & Cost Analysis

**Author:** Richard Forjoe
**Last updated:** 2026-04-26
**Status:** POC built (~2 days). Sections 1–7 are the original evaluation & plan. Sections 8–12 are the post-build retrospective, real cost data, refined V1 estimate, and a non-technical summary for Toni.

---

## 1. Context

Balance_UK is a Pilates studio run by Franki (friend of Toni). Studio location: BALANCE STUDIO (within Bactive Fitness Centre), Mill Lane, Warton, Preston, PR4 1AX. They currently use **Bookwhen** for class bookings and need to move off it.

### Pain points with Bookwhen (from Toni)
- Poor UX for older / non-tech-savvy customers — the core demographic.
- Glitchy.
- After filling in the PAR-Q (health questionnaire), users get **locked out for ~15 minutes** and can't book — costs them bookings regularly.
- No on-demand video library / membership integration ("Pocket Pilates" exists but feels bolted on).
- **No public API** → can't put a custom UI on top of it.

### What Franki actually needs (jobs-to-be-done)
1. Easy live class booking, frictionless for older users.
2. On-demand video library (pre-recorded classes) — already a product called Pocket Pilates at £9.99/month.
3. Monthly membership tier (live + on-demand bundle).
4. Card payments.
5. PAR-Q / waiver flow that doesn't break booking.
6. Everything in one place — single login, single brand.

---

## 2. Brand & product reference

### Brand language (from balanceuk.uk + current Bookwhen)

| Aspect | Detail |
|---|---|
| Wordmark | "BALANCE" — all caps, thin / light weight, generous letter-spacing |
| Tagline | "✨ mind ✨ body ✨ strength ✨" with pastel sparkle accents |
| Promise | "Strong bodies, happy hearts — Pilates for **EVERY** body" |
| Tone | Warm, inclusive, body-positive |
| Background | White / cream — calm, airy |
| Imagery | Botanical greens, bright studio photography, plenty of negative space |
| Accents | Soft pastel highlights only |

### Audience profile (explicit on the site)
- **Over 40s** programmes
- **Menopause** support
- **PCOS / endometriosis** support
- **Injury rehabilitation**

→ Accessibility is essential: WCAG 2.2 AA minimum, large fonts, simple flows.

### Product structure (already validated by an operating business)

**Class catalogue** with current pricing:

| Class | Level | Drop-in | Format |
|---|---|---|---|
| Reformer — Flow It | 1 (beginner) | £20 | Group reformer |
| Reformer — Pace It | 2 | £20 | Group reformer |
| Reformer — Werk It | 3 (advanced) | £20 | Group reformer |
| Infrared Reformer — Ignite It | 2 | £20 | Heated reformer |
| Infrared Mat — Simmer It | 1 | £12 | Heated mat |
| Barre Pilates | All | £10 | Mat / barre |
| Pocket Pilates — On Demand | n/a | £9.99 / 30 days | Video library |
| 1-2-1 / 2-2-1 / Small group | n/a | POA | Private |

**Commercial products:**

| Type | Examples | Rules |
|---|---|---|
| **Memberships** (Reformer) | 4-class £68 → Unlimited £220 | Rolling monthly; 2-month initial commitment; 1-month cancellation notice |
| **Class Passes** (Reformer) | 1 pass £20, 4 passes £72 | Valid for one calendar month |
| **Mat Passes** | Barre 1×£10 / 4×£36; Simmer 1×£12 / 4×£44 | Valid for one calendar month |
| **On Demand** | Pocket Pilates £9.99 / 30 days | Recurring, members-only video library |
| **Vouchers** | Discount codes | Applied at basket |

**Current booking flow (Bookwhen):** Schedule grid → click class → details → **add to basket** (multi-class) → basket page → voucher field → **Book now** → payment.

→ The custom system supports basket-based, multi-class purchase (matches mental model).

---

## 3. The 3 options compared

### Option A — Custom build on AWS

Own the whole stack. Cognito auth, AppSync GraphQL, DynamoDB, Lambda, S3+CloudFront, Stripe.

**Pros:** total UX control, fix the PAR-Q lockout, design for accessibility, owned IP.
**Cons:** re-implementing things SaaS already solves; ongoing maintenance forever.
**Year-1 TCO:** **£35k–£100k+**

### Option B — Hybrid (SaaS backend + custom UI via API)

**Teamup** is the only mainstream UK fitness booking platform with a real public API. Use their booking / payments / membership engine, build the React frontend on top.

**Pros:** skip the hard parts (payments, memberships, refunds, PCI scope); fix the actual problem (UX) for a fraction of the cost.
**Cons:** bound by Teamup's data model; API limits; some features may not be exposed.
**Year-1 TCO:** **£10k–£17k**

### Option C — Pure off-the-shelf (switch SaaS)

| Tool | Price | Notes |
|---|---|---|
| **Fitune** | Free–£70/mo | "Netflix-like" on-demand library, memberships, embeddable widget, modern UI. Smallest learning curve. |
| **Momence** | ~£80/mo + 2.5% txn | Strong on-demand, marketing automation. Acquired late 2025 — roadmap unclear. |
| **Teamup** | ~£82/mo | Strong booking & on-demand. Less modern UI. |

**Pros:** live in days; built-in support, GDPR, payments, accessibility, mobile apps.
**Cons:** vendor UX; data export friction.
**Year-1 TCO:** **£0–£1,500**

### Comparison summary

|  | Option A (custom) | Option B (hybrid) | Option C (SaaS) |
|---|---|---|---|
| Year-1 cost | £35k–£100k+ | £10k–£17k | £0–£1.5k |
| Time to launch | 3–6 months | 4–8 weeks | Days |
| UX control | Full | Mostly | Vendor only |
| Vendor lock-in | None | Partial | Full |
| Maintenance burden | High (forever) | Medium | None |
| GDPR / a11y / payments | DIY | Vendor | Vendor |
| Best fit | Multi-studio platform | Mid-route compromise | Single small studio |

---

## 4. Recommendation

**For Franki / the studio:** **Trial Fitune first.** If the UX passes the "Toni's mum test", that's the answer — keep it. The economics of a custom build don't make sense at single-studio revenue scale.

**For Richard:** **Run the AWS POC in parallel** as a learning / portfolio exercise. The only commercial story that justifies a custom build is going **white-label / multi-tenant** — Balance UK as design partner / first customer of a Pilates platform that licenses to other studios.

**Be straight with Franki about this** before any custom build commitment.

---

## 5. Decisions locked

These were the constraints set going into the build:

1. **Direction:** all 3 packages built (web + infra + functions). v0 = booking flow only — no Stripe, no passes, no memberships, no Pocket video.
2. **Auth UX:** Cognito hosted UI for POC speed. *(In practice we built custom email/password forms via Amplify v6 instead — better for older users; net positive deviation.)*
3. **Stripe:** stub payments in v0. Real Stripe wired in V1.
4. **Palette:** mirrors balanceuk.uk (cream / charcoal / botanical greens / pastel sparkle accents).
5. **Branding:** placeholder serif "BALANCE" wordmark — no logo asset yet.
6. **Domain:** auto-generated CloudFront domain for now. Custom domain (`booking.balanceuk.uk`) is a 1-day add when ready.
7. **Hosting:** existing dev stage of this monorepo. Stack names: `dev-balance-booking-{auth|data|api|functions|web}`.

---

## 6. Custom POC plan on AWS (forward-looking, original)

Treating the AWS build as a build-to-learn / proof-of-concept. Goal:

> A working basket-based booking flow + on-demand video gate that an over-40 customer can finish without help, end-to-end deployable via the existing CDK pipeline.

### 6.1 Package layout (new package in this monorepo)

```
packages/
  balance-booking-web/                  ← NEW: React frontend
    src/
      components/ui/                    ← Button, Card, Input, Modal — shared primitives
      components/booking/               ← ClassCard, ScheduleGrid, ClassDetail, BookingBasket, ParQForm
      components/commerce/              ← MembershipPicker, PassPicker, VoucherInput
      components/video/                 ← VideoLibrary, VideoPlayer (HLS)
      components/admin/                 ← AdminSchedule, AdminBookings, AdminMembers
      contexts/                         ← AuthContext (Cognito), BasketContext
      hooks/                            ← useClasses, useBookings, useMember, useBasket
      lib/                              ← apiClient (TanStack Query), stripe, theme
      pages/                            ← Schedule, Memberships, Passes, Vouchers, Basket, MyBookings, Videos, Account, Admin
      index.css                         ← Theme vars (Balance UK palette — see §6.4)
    index.html
    package.json
    vite.config.ts

  infrastructure/lib/balance-booking/   ← NEW: CDK stacks
    auth-stack.ts                       ← Cognito user pool + identity pool
    booking-data-stack.ts               ← DynamoDB single-table (classes, bookings, members, memberships, passes, vouchers)
    booking-api-stack.ts                ← AppSync GraphQL API
    booking-functions-stack.ts          ← Lambda resolvers
    video-stack.ts                      ← S3 + CloudFront signed URLs + MediaConvert (transcode to HLS)
    payment-stack.ts                    ← Stripe webhook Lambda + checkout-session Lambda
    notifications-stack.ts              ← SES (booking confirmations) + EventBridge (reminders)
    web-stack.ts                        ← S3 + CloudFront for the new frontend

  functions/src/balance-booking/        ← NEW: Lambda handlers
    book-basket/                        ← atomic multi-class booking (capacity check + dedupe per item)
    cancel-booking/                     ← refund via Stripe, free capacity
    list-classes/                       ← public schedule
    parq-submit/                        ← one-time PAR-Q, persisted on member record (FIXES the lockout bug)
    create-checkout-session/            ← Stripe Checkout for basket / passes / memberships
    stripe-webhook/                     ← payment confirmation, subscription lifecycle
    redeem-voucher/                     ← validate + apply voucher to basket
    purchase-pass/                      ← create pass with month-end expiry
    use-pass/                           ← decrement pass on booking
    purchase-membership/                ← Stripe Subscription with 2-month commitment metadata
    cancel-membership/                  ← enforce 1-month notice
    send-reminder/                      ← scheduled by EventBridge
    video-signed-url/                   ← CloudFront signed cookie/URL for Pocket Pilates members
    admin-create-class/                 ← studio creates classes
    admin-list-bookings/                ← studio sees who's coming
```

This slots into the existing CDK app exactly like `JiraDashboardStack` does — wired in `bin/app.ts` with stage-aware naming `{stage}-balance-booking-*`, reusing the deploy / destroy / cleanup scripts unchanged.

### 6.2 AWS backend — recommended architecture

| Concern | Service | Why |
|---|---|---|
| Auth (members + admins) | **Cognito** | Free up to 50k MAU. Custom forms from day one (older audience — hosted UI is a known accessibility liability). |
| API | **AppSync (GraphQL)** | Already used in this repo. Subscriptions help live admin views. Direct DynamoDB resolvers cut Lambda cold-starts. |
| Data | **DynamoDB single-table** | PAY_PER_REQUEST in dev. Schema in §6.6. Streams → reminder scheduler. |
| Payments | **Stripe** (not AWS) + Lambda webhook | AWS doesn't do payments. Stripe Checkout = least PCI scope. Stripe Subscriptions handle recurring memberships. Stripe metadata holds commitment-term info for cancellation rules. |
| Video on-demand | **S3 → MediaConvert (HLS) → CloudFront (signed cookies)** | Studio uploads MP4, Lambda triggers MediaConvert, output back to S3, CloudFront serves with signed cookies validated against Cognito + active Pocket Pilates subscription. |
| Email | **SES** | Booking confirmations, password reset, class reminders, membership renewal notices. Domain verification + DKIM required. |
| SMS reminders (optional) | **SNS / Pinpoint** | Older users often prefer SMS. ~£0.05/msg UK. |
| Scheduled jobs | **EventBridge Scheduler** | Class reminders 24h / 2h before start. No-show automation. Pass / membership expiry sweeps. |
| Frontend hosting | **S3 + CloudFront** | Same pattern as `WebAppStack`. |

**Things AWS doesn't solve that are still owned:**
- GDPR data subject requests (export / delete member data) — needs a Lambda + admin tool.
- VAT invoicing — Stripe Tax (1.5% extra) or DIY in Lambda.
- Accessibility audit (critical given audience) — manual testing + WCAG 2.2 AA pass; ideally a real session with 2–3 over-60 testers.
- Membership commitment-term enforcement — bespoke business logic, not in any SaaS billing engine off-the-shelf.

### 6.3 POC v0 scope — booking flow only

Per §5.1: prove the booking flow end-to-end first. Strip everything else.

**v0 in scope:**
1. Member sign-up / login.
2. **Public schedule view** — week list, level chips (1/2/3), capacity indicator.
3. Class detail page.
4. **Add to basket → basket page → confirm booking** flow.
5. **Stub payment** — "Confirm booking" button records the booking with `paymentMethod: 'STUB'`. No Stripe in v0.
6. **One-time PAR-Q** on first booking, persisted on member record (the headline bug fix).
7. My Bookings page (upcoming / past, cancel).
8. Studio admin (Cognito group): create / edit class instances, view bookings per class.

**v0 explicitly out** (added in subsequent versions):
- Stripe / real payments.
- Class passes, memberships, vouchers (UI placeholders only — no logic).
- Pocket Pilates on-demand video gate.
- Email confirmations / reminders (SES).
- Recurring class templates, waitlists, instructor management, marketing automation, SMS, private session booking.

### 6.4 UI strategy — Balance UK brand, cloud-sandbox engineering scaffold

The look is **Balance UK's** (white / cream / botanical greens / pastel accents), **not** cloud-sandbox's dark dev-tooling theme. What we lift from cloud-sandbox is the *engineering* (Tailwind v4 theme variables, React 19, Vite, TanStack Query, Biome lint, component patterns like `Skeleton`, `ErrorBoundary`, `StatusBadge`). The palette and tone are reset.

**Proposed Tailwind theme (`index.css`):**

```css
@theme {
  /* Surfaces */
  --color-cream: #FAF7F2;          /* page background */
  --color-white: #FFFFFF;          /* cards, panels */
  --color-stone: #F0EBE4;          /* subtle surface raised */

  /* Brand */
  --color-charcoal: #1A1A1A;       /* "BALANCE" wordmark, body text */
  --color-text: #2C2C2C;
  --color-text-muted: #6B6B6B;
  --color-text-dim: #9C9C9C;

  /* Accents — pastel sparkle echo */
  --color-blush: #F4D6D6;
  --color-blush-deep: #D4928D;
  --color-sage: #9DB39C;
  --color-lavender: #D6CFE3;
  --color-butter: #F4E4B5;

  /* Semantic */
  --color-success: #6E9F6E;
  --color-warning: #D4A574;
  --color-error: #B85450;

  /* Typography */
  --font-display: 'Cormorant Garamond', Georgia, serif;
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

  /* Sizing — bumped for older audience */
  --text-base: 18px;
  --text-lg: 20px;
}
```

**Accessibility-first defaults:**
- Base font 18px, line-height 1.6.
- Tap targets ≥48×48px.
- Form inputs labelled above (not inside), no placeholder-as-label.
- High contrast: charcoal on cream is ~12:1 (well above WCAG AAA 7:1).
- Respect `prefers-reduced-motion`.
- One primary CTA per page. Plain language ("Book this class", not "Reserve").

### 6.5 Page inventory (POC)

| Page | Purpose | Notes |
|---|---|---|
| `/` (Schedule) | Browse classes, add to basket | Week grid + day list. Filter by level / format. |
| `/class/:id` | Class detail, add to basket | Shows level, instructor, location, what to bring. |
| `/passes` | Buy class passes | Reformer 1× / 4×; Mat options. |
| `/memberships` | View memberships *(read-only in POC)* | Marketing page; "Buy" disabled in POC. |
| `/vouchers` | Voucher info | Information only. |
| `/basket` | Review + checkout | Discount code field. "Book now" → Stripe Checkout. |
| `/parq` | One-time PAR-Q | First-booking flow only. Skipped on subsequent bookings. |
| `/my/bookings` | Upcoming + past, cancel | Member only. |
| `/my/passes` | Active passes + expiry | Member only. |
| `/pocket-pilates` | On-demand library | Gated; shows preview if not subscribed. |
| `/account` | Profile, password, GDPR export | Member only. |
| `/admin/schedule` | Studio: create/edit classes | Admin role only. |
| `/admin/bookings` | Studio: view bookings per class | Admin role only. |

### 6.6 Data model (DynamoDB single-table)

| pk | sk | Attributes |
|---|---|---|
| `MEMBER#{userId}` | `PROFILE` | name, email, phone, parqCompletedAt, parqAnswers, role |
| `MEMBER#{userId}` | `BOOKING#{classInstanceId}` | classId, classDate, status, paymentMethod, passId? |
| `MEMBER#{userId}` | `PASS#{passId}` | type, remaining, expiresAt, sourcePaymentId |
| `MEMBER#{userId}` | `MEMBERSHIP#ACTIVE` | tier, stripeSubId, startedAt, commitmentEndsAt, cancelEffectiveAt |
| `MEMBER#{userId}` | `POCKET#ACTIVE` | stripeSubId, currentPeriodEnd |
| `CLASS#{date}` | `INSTANCE#{classInstanceId}` | classType, level, startsAt, durationMin, capacity, booked, instructor |
| `CLASSTYPE#{slug}` | `META` | name, description, level, dropInPrice, format |
| `VOUCHER#{code}` | `META` | percentOff or amountOff, validFrom, validTo, usesRemaining |
| `VIDEO#{videoId}` | `META` | title, durationMin, hlsKey, thumbnailKey, category |

GSIs:
- **GSI1** `byClassInstance`: pk = `CLASS#{date}#{classInstanceId}`, lists all bookings for a class (admin view).
- **GSI2** `byEmail`: lookup member by email.

### 6.7 Original effort & cost estimate (custom POC only)

| Phase | Effort (senior) | UK contractor cost | Outsourced cost |
|---|---|---|---|
| POC (scope above) | 30–40 days | £15k–£28k | £9k–£16k |
| Production v1 (recurring memberships + 2-month commitment, full Pocket library, admin polish, a11y audit, mobile PWA) | +50–70 days | +£25k–£50k | +£15k–£28k |
| Year-1 hosting (AWS + Stripe + SES + domain) | — | ~£500–£1,500 | same |

> **See §10 for the *actual* POC cost (much lower than this original estimate — turned out a lot of the scaffold was reusable from the existing repo) and §11 for the refined V1 estimate.**

---

## 7. Build phases (forward-looking, original)

### Phase 0 — Validate SaaS options first (1–2 weeks, near-zero cost)

Before writing a line of code, exhaust the cheaper options. **Evaluate Fitune and Teamup in parallel** — they cover all three downstream paths:

| Tool | If UX is good enough → | If UX fails but data/API works → |
|---|---|---|
| **Fitune** (free tier) | Option C: switch SaaS, ~£0–£70/mo. Done. | No public API — dead end, move on. |
| **Teamup** (book a demo) | Option C: switch SaaS, ~£82/mo. Done. | Option B: keep their backend, build custom UI on top (~£10–17k). |

Steps:
1. Sign Franki up to **Fitune free tier**, walk her through setting up classes, passes, memberships, on-demand video.
2. **Book a Teamup demo** (no public free trial). Confirm via demo: (a) does the customer-facing UI work for older users? (b) does the API expose schedule, booking, payments, memberships, and on-demand video?
3. **Toni's mum test** — get 2–3 over-60 customers to attempt a real booking on each platform vs Bookwhen. Time each flow. Note exactly where they get stuck.
4. Compare against Bookwhen on the specific failures (PAR-Q lockout, glitchiness, on-demand bolt-on).

Decision tree:

- **Either SaaS UI passes** → switch to it (Option C). **Stop here, save £35k+**. Done.
- **Teamup UI fails but API is sufficient** → **Option B**: skip to a slimmed Phase 1 building only the frontend against Teamup's API. ~3–5 weeks, ~£8–15k.
- **Both fail (UX *and* Teamup's API is too limited)** → continue to full custom Phase 1 below.

This phase is the most important one. It's also the one that's easiest to skip in excitement to start building. **Don't skip it.**

### Phase 1 — POC scaffold (week 1–2)
- New `packages/balance-booking-web/` from cloud-sandbox engineering patterns + Balance UK palette.
- New CDK stacks: `auth-stack`, `booking-data-stack`, `booking-api-stack`, `web-stack` wired into `bin/app.ts`.
- Deployable to `dev` stage via existing `npm run deploy:dev`.
- Stub class data in DynamoDB — Reformer + Mat catalogue from §2.

### Phase 2 — Booking core (week 3–5)
- Cognito sign-up / login (custom forms).
- Schedule view → class detail → **add to basket** → basket page → Stripe Checkout (drop-in payment).
- Voucher field.
- One-time PAR-Q on member record (the headline bug fix).
- SES booking confirmation + 24h reminder.

### Phase 3 — Passes (week 6)
- Pass purchase (Reformer 1× / 4×, Mat 1× / 4×) via Stripe.
- Use pass at checkout instead of card.
- Auto-expire at month end.
- My Passes page.

### Phase 4 — Pocket Pilates gate (week 7)
- `video-stack`: S3 upload → MediaConvert (HLS) → CloudFront with signed-cookie Lambda.
- One demo video gated by Pocket Pilates active subscription.
- Player in frontend (HLS.js).

### Phase 5 — Admin minimal (week 8)
- Studio admin login (Cognito group).
- Create / edit class instance.
- View bookings per class.

### Phase 6 — Show Franki, decide
- Demo end-to-end with real over-60 testers (the same group that struggled with Bookwhen).
- Decide: kill, productionise, or pivot to multi-tenant Pilates platform play.

---

## 8. POC retrospective — what was actually built in ~2 days

The POC is real, deployed, and functional. It's not a mockup — it's a working multi-stage AWS application with a CI/CD pipeline.

### Functionality delivered

✅ **Public schedule browse** — anyone can see classes without signing in (uses an AppSync API key for unauthenticated reads).
✅ **Member sign-up + sign-in** — Cognito user pool with custom email/password forms via AWS Amplify v6.
✅ **One-time PAR-Q gate** — health form submitted once, stored on the member record, **never blocks future bookings** (the headline Bookwhen bug fix).
✅ **Multi-class basket booking** — atomic transaction that capacity-checks every class and writes the bookings as one unit; rolls back if any class is full.
✅ **My Bookings** — upcoming and past bookings with cancel-within-window.
✅ **Admin tools** — gated by Cognito group membership; create / edit / delete classes; view booking list per class.
✅ **Stage-isolated environments** — dev, test, prod, and per-PR previews (`pr-N-balance-booking-*`).
✅ **Brand-faithful UI** — Cormorant serif wordmark, Inter body, cream/charcoal/sage/blush palette inspired by balanceuk.uk; 18px base font and 48×48 px tap targets for the older audience.

### Functionality deliberately deferred (V1 scope)

❌ Real Stripe card payments (currently stubbed: "Confirm booking" → instant success, `paymentMethod: 'STUB'`)
❌ Class passes (1×, 4× tiers with calendar-month expiry)
❌ Recurring memberships (Stripe Subscriptions + 2-month commitment + 1-month cancellation notice)
❌ Pocket Pilates on-demand video gate (S3 + MediaConvert HLS + CloudFront signed cookies)
❌ Email notifications (booking confirmations, 24h reminders)
❌ Admin polish (instructor management, recurring class templates, waitlists, reports)
❌ Mobile PWA / native app
❌ SMS reminders
❌ Marketing automation (welcome sequence, win-back, abandoned-basket)
❌ Private session booking (1-2-1 / 2-2-1 — handled offline currently)
❌ Voucher logic (UI placeholder only)

### Variance from original plan (§6)

- **Auth:** built custom Amplify forms instead of Cognito Hosted UI (better for older users).
- **Effort:** original estimate was 30–40 days for POC. **Actual: ~2.5 days** because the existing CDK / monorepo / pipeline pattern from this repo eliminated most scaffolding. See §10.
- **Stack count:** built 5 stacks (auth, data, functions, api, web) — 3 deferred (video, payment, notifications) to V1.
- **Lambda count:** 11 handlers in POC; original spec called for 15 (4 deferred: stripe-webhook, create-checkout-session, video-signed-url, send-reminder).

---

## 9. Components & stack (technical inventory of what's deployed)

### Frontend — `packages/balance-booking-web/`

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript 5.5 | Type safety, refactor confidence |
| Framework | React 19 + React Router 7 | Latest stable; mirrors `cloud-sandbox` engineering scaffold |
| Build | Vite 6 | Fast dev server + ESM-native production builds |
| Styling | Tailwind v4 + CSS theme variables | Single-file palette swap; no runtime overhead |
| State (server) | TanStack Query v5 | Cache invalidation, optimistic updates, request dedup |
| State (client) | React Context | Auth + Basket only; nothing else needs global state at this scale |
| Auth client | AWS Amplify v6 | Cognito user pool integration with custom forms |
| GraphQL client | `graphql-request` | Tiny, no runtime schema codegen, pairs well with TanStack |
| Typography | Cormorant Garamond (display) + Inter (body) | Brand-faithful + accessible |

**Pages:** Schedule, BasketPage, ParqPage, MyBookingsPage, AdminPage, AuthCallbackPage.

### Backend — Lambda handlers — `packages/functions/src/balance-booking/`

ESM, Node 20, AWS SDK v3, all bundled by esbuild via CDK's `NodejsFunction`. 11 handlers:

| Handler | Trigger | Auth |
|---|---|---|
| `list-classes` | Public schedule | API_KEY or Cognito |
| `me` | Read profile | Cognito |
| `list-my-bookings` | Member bookings | Cognito |
| `parq-submit` | One-time PAR-Q | Cognito |
| `book-basket` | Atomic multi-class booking | Cognito |
| `cancel-booking` | Cancel + restore capacity | Cognito |
| `admin-create-class` | New class instance | Cognito + admin group |
| `admin-update-class` | Edit class fields | Cognito + admin group |
| `admin-delete-class` | Delete + cancel bookings | Cognito + admin group |
| `admin-list-bookings` | View bookings per class | Cognito + admin group |
| `seed-classes` | One-shot sample data | Manual invoke |

### Infrastructure — CDK stacks — `packages/infrastructure/lib/balance-booking/`

| Stack | AWS resources |
|---|---|
| `auth-stack` | Cognito user pool + admin group + hosted UI domain |
| `data-stack` | DynamoDB single-table + GSI1 + streams |
| `functions-stack` | 11 Lambdas with table read/write grants |
| `api-stack` | AppSync GraphQL — USER_POOL + API_KEY + IAM auth modes |
| `web-stack` | S3 bucket + CloudFront with Origin Access Control (OAC) |

All wired in `bin/app.ts` with stage-aware naming `${stage}-balance-booking-*`. Identical pattern to existing stacks (database, lambda, appsync).

### Database — DynamoDB single-table (built subset of §6.6)

| `pk` | `sk` | What |
|---|---|---|
| `MEMBER#{userId}` | `PROFILE` | Member profile + PAR-Q answers |
| `MEMBER#{userId}` | `BOOKING#{id}` | A booking |
| `CLASS#{date}` | `INSTANCE#{id}` | A class instance |

GSI1 indexes bookings by class instance for the admin "who's coming" view.

### CI/CD — `.github/workflows/`

| Workflow | Trigger | What |
|---|---|---|
| `balance-booking-pr-preview.yml` | PR opened/sync/closed | Per-PR isolated env at `pr-N-balance-booking-*`; auto-destroys on merge |
| `balance-booking-deploy.yml` | Manual dispatch | Deploy to dev / test / prod with optional admin bootstrap |
| `balance-booking-destroy.yml` | Manual dispatch | Tear-down with `DESTROY` confirmation |

### Operational scripts — `scripts/`

| Script | Purpose |
|---|---|
| `deploy-balance-booking.sh` | Two-pass deploy: backend → configure web env → build web → deploy web → update Cognito callbacks → seed → bootstrap admin |
| `destroy-balance-booking.sh` | Reverse-order stack teardown |
| `configure-balance-webapp.sh` | Read CFN outputs → write `.env.{stage}` for the frontend |
| `create-admin.sh` | Idempotently create / refresh a Cognito admin user |

---

## 10. POC costs — what this 2 days actually cost

### Time breakdown (~20 hours, ~2.5 working days)

| Phase | Hours |
|---|---|
| Planning, scoping, brief writing, SaaS option research | 3 |
| CDK infrastructure (5 stacks + GraphQL schema) | 5 |
| Frontend (pages, theme, auth, basket, admin) | 5 |
| Lambda handlers (11 functions + shared modules) | 4 |
| CI/CD pipeline (3 workflows + 4 scripts) | 3 |
| Iterations, code review fixes, deploy debugging | 4 |

### Money cost — **as built (Richard self-built)**

| Item | Cost |
|---|---|
| Developer time | £0 (own time) |
| AWS during build | <£10 (negligible — most resources still inside free tier) |
| **Total to date** | **<£10** |

### Money cost — **had it been a senior UK contractor**

At median UK senior React + AWS rate of £510/day (10th–90th percentile £360–£715/day):

| Item | Low | High |
|---|---|---|
| 2.5 days of senior contractor time | £1,275 | £1,790 |
| AWS during build | £10 | £10 |
| **Total** | **~£1,300** | **~£1,800** |

### Money cost — **had it been outsourced** (Poland/Romania ~£300–£400/day)

| Item | Low | High |
|---|---|---|
| 2.5 days outsourced | £750 | £1,000 |
| AWS during build | £10 | £10 |
| **Total** | **~£760** | **~£1,010** |

**Why it cost so much less than the §6.7 estimate (30–40 days):** the existing monorepo had a working CDK pipeline, deployment scripts, drift detection, GitHub Actions integration, and a TypeScript Lambda build pattern. The first 60% of typical greenfield AWS projects was already done. A from-scratch build (no existing repo) would still hit the 30–40 days estimate.

### Ongoing cost — **just keeping the POC alive in dev**

| Service | Estimate |
|---|---|
| DynamoDB on-demand | £2–£5/mo |
| Lambda | <£1/mo (free tier 1M req) |
| AppSync | <£1/mo (free tier 250k queries) |
| Cognito | £0 (free up to 50k MAU) |
| S3 + CloudFront | £2–£5/mo |
| CloudWatch logs | £2–£5/mo |
| **Total** | **~£10–£20/mo** |

PR preview environments auto-destroy on merge so they cost a few pence per day they're alive. No standing cost.

---

## 11. Path to V1 — refined estimate (informed by POC)

The POC proved the architecture works. To get to a **production-ready V1** that Franki could actually use as her primary booking system, here's the remaining work, sized in days of senior dev effort.

### Remaining engineering work

| Feature | Days | Notes |
|---|---|---|
| Stripe Checkout for drop-in payments + webhook | 5 | One-off card payments, refund handling |
| Stripe Subscriptions for memberships | 8 | Recurring billing; rolling 2-month commitment + 1-month notice is the gnarly bit |
| Class passes (1×, 4×) with calendar-month expiry | 3 | Pass purchase, balance display, pass-burning at booking |
| Pocket Pilates video pipeline | 8 | S3 upload → MediaConvert → HLS → CloudFront signed cookies → HLS.js player |
| Email notifications (SES) | 3 | Booking confirmations + 24h reminders + receipts |
| Custom auth forms replacing Amplify defaults | 4 | Better accessibility for over-60 audience |
| Recurring class templates | 3 | Admin creates a weekly pattern, system materialises instances |
| Waitlists | 3 | Auto-promote when someone cancels |
| Voucher logic | 2 | Discount codes applied at basket |
| Marketing automation | 3 | Welcome series, abandoned-basket recovery |
| Admin polish (instructors, reports, instructor view) | 5 | Instructor management, attendance reports |
| Mobile PWA (offline tickets, push notifications) | 5 | Native-app-feel without a separate codebase |
| **WCAG 2.2 AA audit + fixes** | 4 | **Non-negotiable for the audience — over-40s, menopause, rehab** |
| End-to-end testing (Playwright + 3 real over-60 users) | 5 | Critical: this is the test that decides whether we ship |
| Documentation + handover | 3 | Runbooks, admin guide, customer FAQ |
| Buffer for unknowns | 5 | Always present, never small enough |

**Total remaining: ~62 days senior dev effort**

### Full project budget — POC + V1

| Sourcing | Day rate | Total days | **Project cost** |
|---|---|---|---|
| Senior UK contractor (median) | £510 | 65 | **~£33,000** |
| Senior UK contractor (specialist, top end) | £715 | 65 | **~£46,500** |
| Outsourced — Poland / Romania | £350 | 65 | **~£23,000** |
| Outsourced — India (with strong tech-lead oversight) | £200 | 65 | **~£13,000** ⚠️ |

⚠️ The cheaper outsourced figure assumes constant tech-lead supervision. Without it, quality risk rises sharply on a payment + auth + GDPR system.

**Realistic UK senior contractor budget: £35,000 – £45,000.**

### Year-1 running costs (after V1 launches)

| Item | Monthly | Annual |
|---|---|---|
| AWS (small studio scale) | £40 – £120 | £480 – £1,440 |
| Stripe payment fees | 1.5% + 20p per UK card | Variable |
| Stripe Tax (optional) | 0.5% per txn | Variable |
| SES emails | <£5 | <£60 |
| Domain registration | n/a | £10 |
| **Maintenance dev time** (security patches, library upgrades, bug fixes) | 1–2 days | 12–24 days × £510 = **£6,100 – £12,250** |
| Per-incident bug fix budget | n/a | ~£2,000 |

**Year-1 ongoing total: £8,000 – £15,000 + AWS bill + Stripe fees on whatever turnover the studio does.**

### Total cost of ownership comparison

|  | Year 0 | Year 1 | Year 2 | Year 3 | **3-year total** |
|---|---|---|---|---|---|
| **Custom build (Option A)** | £35k–£45k | £10k–£15k | £10k–£15k | £10k–£15k | **£65k–£90k** |
| **Hybrid (Option B, Teamup API + custom UI)** | £10k–£17k | £3k–£6k | £3k–£6k | £3k–£6k | **£19k–£35k** |
| **Fitune SaaS (Option C)** | £0 | £0–£1.5k | £0–£1.5k | £0–£1.5k | **£0–£4.5k** |

For a single studio doing ~£100k–£200k turnover annually, the custom build's **Year-3 total is 20–35× the SaaS cost.** Custom is only defensible if there's a path to recover that — i.e. multi-studio platform play.

---

## 12. For Toni — plain-English summary

(Skip everything above. This section is everything you need to know.)

### What we built in 2 days

A working test version of a new booking system, in an isolated copy that doesn't touch Bookwhen. Right now it:

- Shows your classes on a public schedule page (no sign-in needed to browse)
- Lets a customer sign up with email + password
- Asks the health questionnaire **once** when they first try to book — never lock-out them out again
- Lets them add multiple classes to a basket and book them all at once
- Has an admin login for Franki to add, edit, and delete classes, and see who's booked into each one

It's a live website you can click through. It's deployed to AWS (Amazon's cloud).

### What it doesn't do yet

- **No real card payments.** The "Confirm booking" button currently fakes the payment — it records the booking but no money moves. Adding Stripe (the payment processor) is a few days of work.
- **No on-demand videos** (Pocket Pilates). The video infrastructure is straightforward AWS work but it's a chunk of effort.
- **No monthly memberships.** Recurring billing with the 2-month minimum and 1-month cancellation notice is fiddly — about a week and a half of work.
- **No automatic emails** to confirm bookings or remind customers of upcoming classes.
- **No mobile app.** It works fine on a phone browser, but isn't a downloadable app.

### What it would cost to finish for real

The honest numbers:

| Sourcing approach | One-off build cost | Ongoing cost / year |
|---|---|---|
| UK senior developer | **£35,000 – £45,000** | £8,000 – £15,000 |
| Outsourced (Eastern Europe) | **£20,000 – £25,000** | £4,000 – £8,000 |
| Outsourced (India, with oversight) | **£12,000 – £15,000** ⚠️ | £4,000 – £8,000 |

Plus AWS hosting (£40–£120/month — a few pounds a day) and Stripe fees (about 1.7% per booking, similar to Bookwhen).

**Total over 3 years for the UK route: £65,000 – £90,000.**

### The honest comparison

| Option | What you get | 3-year cost |
|---|---|---|
| **Switch to Fitune** (free or up to £70/mo) | A modern booking system with on-demand videos, memberships, mobile app — already built, used by hundreds of studios | **£0 – £2,500** |
| **Hybrid** (Teamup backend + custom-designed UI) | The Fitune-equivalent backend, but with your own designed booking flow on top | **£19,000 – £35,000** |
| **Full custom build** (what we're prototyping) | Total control. Owned IP. Anything you want, exactly how you want it. | **£65,000 – £90,000** |

### My honest recommendation

**Try Fitune first.** It's free to set up. Has on-demand videos out of the box. Has memberships. Has a mobile app. Get 2–3 of your over-60 customers to actually try booking through Fitune vs Bookwhen. If they can do it without help, **stop there — that's your answer**, and the studio saves £35,000+.

The custom build only makes sense if either:

1. **Fitune fails the older-customer test** — and Teamup's API does enough that the Hybrid route gets you something better for £20k instead of £45k.
2. **You and Franki want to turn it into a product** — license a polished version of this booking system to other Pilates studios for £100–£200/month each. With ~30 studios paying, the build cost pays back in a year. That's a real business; building this for one studio in isolation isn't.

### What we have right now

The 2-day POC is a real, deployed thing. It's not throwaway — every component (the auth, the booking engine, the admin tools, the deploy pipeline) is production-quality code. **It just doesn't have all the features yet.** So if you ever decide to go custom, none of this work is wasted — it's the first ~15% of the V1 build.

### Risks worth flagging

- **GDPR.** A custom system means you (or your developer) are responsible for handling data deletion / export requests, retention, encryption, audit logs. Fitune handles that for you.
- **Card payment compliance (PCI).** Stripe Checkout limits exposure but you still have legal responsibilities. Again, Fitune handles this.
- **Accessibility.** Your audience skews older; many use assistive tech. A custom build needs a proper WCAG 2.2 AA audit (£2k–£5k of specialist time). Fitune passes this out of the box.
- **Maintenance burden.** A custom system needs ~1–2 days of developer time per month to stay secure as AWS deprecates services and dependencies update. That's £500–£1,000/month, indefinitely.

### The single number to remember

A small studio doing £150k/year in classes will spend about **£2,500 over 3 years on Fitune** versus about **£75,000 on a custom build**. The custom build buys differentiation; Fitune buys a working product tomorrow. Pick what matches the business goal.

---

## 13. Reference material

### External pricing sources
- [TeamUp pricing](https://goteamup.com/pricing/)
- [Momence pricing](https://momence.com/pricing)
- [Fitune pricing](https://www.fitune.io/pricing)
- [ITJobsWatch — Senior Software Developer contractor rates](https://www.itjobswatch.co.uk/contracts/uk/senior%20software%20developer.do)
- [Index.dev — UK & European developer rates 2026](https://www.index.dev/blog/european-developer-hourly-rates)

### Balance UK
- Public site: https://balanceuk.uk/
- Pricing: https://balanceuk.uk/prices
- Classes: https://balanceuk.uk/classes
- Current booking (Bookwhen): https://bookwhen.com/balanceuk

### Internal
- POC code: `packages/balance-booking-web/`, `packages/functions/src/balance-booking/`, `packages/infrastructure/lib/balance-booking/`
- POC pipeline: `.github/workflows/balance-booking-*.yml`
- POC scripts: `scripts/{deploy,destroy,configure-balance-webapp,create-admin}.sh`
- This repo's `CLAUDE.md` — CDK stack patterns to mirror.
