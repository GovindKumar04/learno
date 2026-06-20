# Fillip Skill Academy — Backend API Documentation

REST API for the Fillip Skill Academy platform. Handles authentication & roll
numbers, course management (modules, materials, reviews), enrollments, learning
progress, payments, the affiliate program, scholarships, instructor teaching
requests, classroom batches & attendance, scheduled **live (Zoom/Meet) classes**
& their attendance, the public site config, blogs/testimonials CMS, an AI support
assistant, and the contact/enquiry support portal.

### Delivery modes

A course can be sold and taught in any combination of three **delivery modes**.
The same vocabulary is used across courses (`modes`), enrollments
(`enrollmentType`), teaching requests, and batches:

| Mode | Meaning | Price field |
|------|---------|-------------|
| `self-paced` | Recorded content the student watches on their own (was "online") | `priceOnline` |
| `classroom`  | In-person batches at a venue (was "offline") | `priceOffline` |
| `live`       | Scheduled Zoom / Google Meet sessions | `priceLive` |

> The `priceOnline` / `priceOffline` field names are kept for backward
> compatibility; they map to `self-paced` / `classroom` respectively.

- **Runtime:** Node.js + Express 5 (ES Modules)
- **Databases:** PostgreSQL (users / auth, payments, affiliates & commissions) + MongoDB via Mongoose (courses, enrollments, progress, enquiries, scholarships, teaching requests, batches, attendance, site config)
- **Media storage:** Cloudinary (course thumbnails, lesson materials)
- **Payments:** Razorpay (order creation + signature verification)
- **Email:** Nodemailer (enquiry replies, payment confirmations, affiliate & batch notifications)

### Roll numbers

Every registered user is assigned a unique **roll number** of the form
`FSA-<ROLE>-<YY>-<NNNN>` — e.g. `FSA-STU-26-0001`:

| Segment | Meaning |
|---------|---------|
| `FSA`   | Brand prefix (Fillip Skill Academy) |
| `ROLE`  | Role code — `STU` student · `INS` instructor · `ADM` admin · `AFF` affiliate (fallback `USR`) |
| `YY`    | Signup year, 2 digits (`26` = 2026) |
| `NNNN`  | Zero-padded sequence, counted **per role per year** |

The sequence is generated in `utils/roll.util.js` and stored in
`users.roll_number` (UNIQUE). It makes filtering trivial — e.g. all 2026 students
are `roll_number LIKE 'FSA-STU-26-%'`, anyone from 2026 is `FSA-%-26-%`. The roll
is returned by `/auth/me`, `/auth/login`, and `/auth/register`, is searchable in
the admin user/enrollment lists, and is shown on the student dashboard. See
[Migrations](#migrations) to add the column / backfill existing users.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Migrations](#migrations)
3. [Base URL](#base-url)
4. [Authentication & Roles](#authentication--roles)
5. [Standard Response Format](#standard-response-format)
6. [Error Handling](#error-handling)
7. [Endpoints](#endpoints)
   - [**Complete Route Reference**](#complete-route-reference) — every route at a glance
   - [Auth](#1-auth----auth)
   - [Courses](#2-courses----courses)
   - [Modules](#3-modules-nested-under-courses)
   - [Materials](#4-materials-nested-under-modules)
   - [Reviews & Testimonials](#5-reviews--testimonials-nested-under-courses)
   - [Contact](#6-contact----contact)
   - [Enquiries](#7-enquiries----enquiries-admin)
   - [Enrollments](#8-enrollments----enrollments)
   - [Progress](#9-progress----progress)
   - [Payments](#10-payments----payments)
   - [Affiliates](#11-affiliates----affiliates)
   - [Scholarships](#12-scholarships----scholarships)
   - [Teaching Requests](#13-teaching-requests----teaching-requests)
   - [Batches](#14-batches----batches)
   - [Attendance](#15-attendance----attendance)
   - [Online Classes](#23-online-classes----online-classes)
   - [Site Config](#16-site-config----site-config)
   - [Certificates](#17-certificates----certificates-admin)
   - [Mail](#18-mail----mail-admin)
   - [Chat](#19-chat----chat)
   - [Audit Logs](#20-audit-logs----audit-logs-admin)
   - [Blogs](#21-blogs----blogs)
   - [Testimonials](#22-testimonials----testimonials)
8. [Data Models](#data-models)
9. [Environment Variables](#environment-variables)

---

## Getting Started

```bash
cd backend
npm install
npm start          # runs src/server.js (main entry)
```

The server boots only after both databases connect:

```
Connecting to databases...
✅ PostgreSQL connected
✅ MongoDB connected
🚀 Server running on port 3000
```

---

## Migrations

PostgreSQL schema/seed scripts live in `src/migration/` (each loads `.env`
via `import "dotenv/config"`, so run them from the `backend/` folder).

| Script                  | Command                  | What it does                                                                 |
|-------------------------|--------------------------|-----------------------------------------------------------------------------|
| `seed.js`               | `node src/migration/seed.js` | Creates the `users` table & `user_role` enum (fresh installs).          |
| `seedCourses.js`        | `npm run seed:courses`   | Seeds starter courses + modules into MongoDB.                                |
| `addRollNumbers.js`     | `npm run migrate:rolls`  | Adds `users.roll_number` and (re)assigns every user a roll in the current `FSA-<ROLE>-<YY>-NNNN` scheme. Deterministic by signup order, **idempotent**, safe to re-run after a scheme change. |

> **Run `npm run migrate:rolls` once** before relying on roll numbers — the
> registration insert and the user/enrollment list queries reference
> `users.roll_number`, so the column must exist.

---

## Base URL

The Express app mounts routers at the **root** path:

```
http://localhost:3000
```

> **Frontend note:** the React client calls the API through `/api/*` and the Vite
> dev server proxies `/api` → `http://localhost:3000` (stripping the `/api` prefix).
> So `POST /api/auth/login` from the browser hits `POST /auth/login` on the backend.
> All paths in this document are the **backend** paths (no `/api` prefix).

---

## Authentication & Roles

Auth uses **JWT** delivered as **httpOnly cookies** (`accessToken`, `refreshToken`).
A `Bearer` token in the `Authorization` header is also accepted.

```
Authorization: Bearer <accessToken>
```

`verifyJWT` resolves the token (cookie first, then header) and attaches the decoded
payload to `req.user` (`{ id, role, ... }`). `requireRole(...roles)` gates a route to
specific roles.

### Roles

| Role         | Notes                                                                       |
|--------------|-----------------------------------------------------------------------------|
| `student`    | Default for self-registration. Learns, reviews, pays, tracks progress.      |
| `instructor` | Self-registration allowed. Teaching requests, assigned batches, attendance. |
| `admin`      | Full control. **Cannot self-register** — seeded/managed directly.           |
| `affiliate`  | **Cannot self-register** — created by admin on approving an affiliate application. Referral dashboard + resources. |

### Token lifecycle

- **Login** sets `accessToken` + `refreshToken` cookies and returns the user + access token.
- **`POST /auth/refresh`** issues a new access token from the `refreshToken` cookie.
- **Logout** clears both cookies.

---

## Standard Response Format

Every successful response uses a consistent envelope (`ApiResponse`):

```json
{
  "statusCode": 200,
  "data": { "...": "endpoint-specific payload" },
  "message": "Success",
  "success": true
}
```

- `success` is `true` when `statusCode < 400`.
- `data` holds the payload (object, array, or `null`).

---

## Error Handling

A global error handler returns (`ApiError`):

```json
{
  "success": false,
  "statusCode": 400,
  "message": "title, description, and category are required",
  "errors": [],
  "stack": "...(only when NODE_ENV !== 'production')"
}
```

| Status | Meaning                                            |
|--------|----------------------------------------------------|
| 400    | Bad request / validation failure                   |
| 401    | Missing/invalid token, refresh failure             |
| 403    | Authenticated but not allowed (wrong role / scope) |
| 404    | Resource not found                                 |
| 409    | Conflict (e.g. duplicate enrollment)               |
| 500    | Server error                                       |

---

## Endpoints

**Auth legend:** 🔓 public · 🔑 any logged-in user · 👤 student · 🎓 instructor · 🛡️ admin
*(🔓➕ = optional auth — works for guests, behavior adapts if logged in)*

---

### Complete Route Reference

Every backend route, grouped by router (paths are backend paths — the client adds `/api`).

#### `/auth`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | 🔓 | Register a student/instructor (rate-limited; sends email OTP) |
| POST | `/auth/verify-email` | 🔓 | Verify email with the 6-digit OTP |
| POST | `/auth/resend-verification` | 🔓 | Re-send the email verification OTP |
| POST | `/auth/login` | 🔓 | Log in, sets auth cookies |
| POST | `/auth/google` | 🔓 | Sign in / sign up with a Google ID token |
| POST | `/auth/forgot-password` | 🔓 | Email a password-reset code (generic response) |
| POST | `/auth/verify-reset-code` | 🔓 | Validate a reset code (without consuming it) |
| POST | `/auth/reset-password` | 🔓 | Set a new password using a valid code |
| POST | `/auth/logout` | 🔓 | Clear auth cookies |
| POST | `/auth/refresh` | 🔓 | Issue a new access token from the refresh cookie |
| GET | `/auth/me` | 🔑 | Current authenticated user |
| PATCH | `/auth/complete-profile` | 🔑 | Fill phone/location (after Google sign-up) |
| PATCH | `/auth/avatar` | 🔑 | Upload/replace avatar (`multipart`, field `avatar`) |
| POST | `/auth/change-password` | 🔑 | Change own password |
| GET | `/auth/users` | 🛡️ | List users (filter `role`/`search`, paginated) |

#### `/courses` (+ nested modules, materials, reviews)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/courses` | 🔓➕ | List courses (published only for non-admin) |
| GET | `/courses/categories` | 🔓➕ | Distinct course categories |
| GET | `/courses/slug/:slug` | 🔓➕ | Course by URL slug |
| GET | `/courses/:courseId` | 🔓➕ | Course with modules + materials |
| POST | `/courses` | 🛡️ | Create a course (`multipart`, optional `thumbnail`) |
| PATCH | `/courses/:courseId` | 🛡️ | Update a course |
| DELETE | `/courses/:courseId` | 🛡️ | Delete course + cascade |
| POST | `/courses/:courseId/modules` | 🛡️ | Add a module |
| GET | `/courses/:courseId/modules` | 🔓➕ | List modules + materials |
| PATCH | `/courses/:courseId/modules/:moduleId` | 🛡️ | Update a module |
| DELETE | `/courses/:courseId/modules/:moduleId` | 🛡️ | Delete module + materials |
| POST | `/courses/:courseId/modules/:moduleId/materials` | 🛡️ | Upload materials (`multipart`, field `files`, ≤10) |
| DELETE | `/courses/:courseId/modules/:moduleId/materials/:materialId` | 🛡️ | Delete a material |
| GET | `/courses/:courseId/materials/:materialId/file` | 🔓➕ | Stream/download a material file (access-gated) |
| GET | `/courses/:courseId/reviews` | 🔓➕ | Paginated reviews + average rating |
| GET | `/courses/:courseId/reviews/testimonials` | 🔓➕ | Featured reviews only |
| POST | `/courses/:courseId/reviews` | 👤 | Add/update own review (must be enrolled) |
| DELETE | `/courses/:courseId/reviews` | 🔑 | Delete own review (admin: any via `?userId`) |
| PATCH | `/courses/:courseId/reviews/featured` | 🛡️ | Toggle a review's testimonial flag |

#### `/contact`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/contact/info` | 🔓➕ | Phone/email/WhatsApp details |
| POST | `/contact/enquiry` | 🔓➕ | Submit an enquiry (creates a ticket) |

#### `/enquiries` (admin)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/enquiries` | 🛡️ | List enquiries (filters + pagination) |
| GET | `/enquiries/stats` | 🛡️ | Counts by status/role/category + avg response |
| GET | `/enquiries/:id` | 🛡️ | One enquiry + replies + contact links |
| POST | `/enquiries/:id/reply` | 🛡️ | Reply (emails user, marks contacted) |
| PATCH | `/enquiries/:id/status` | 🛡️ | Update status/priority/note |

#### `/enrollments`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/enrollments` | 🛡️ | All enrollments (search + pagination) |
| GET | `/enrollments/unenrolled-students` | 🛡️ | Students with no active enrollment |
| POST | `/enrollments/broadcast` | 🛡️ | Bulk-email students |
| GET | `/enrollments/my-courses` | 🔑 | Caller's enrolled courses + progress |
| GET | `/enrollments/check/:courseId` | 🔑 | Is caller enrolled in a course |
| POST | `/enrollments` | 🛡️ | Enroll a student |
| DELETE | `/enrollments/:enrollmentId` | 🛡️ | Unenroll (soft delete) |
| GET | `/enrollments/course/:courseId/students` | 🛡️ / 🎓 | Students in a course |
| GET | `/enrollments/student/:userId` | 🛡️ | A student's enrollments |

#### `/progress`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/progress/mark-watched` | 🔑 | Mark a material watched (must be enrolled) |
| GET | `/progress/my-progress/:courseId` | 🔑 | Caller's detailed course progress |
| GET | `/progress/course/:courseId` | 🛡️ / 🎓 | All students' progress in a course |
| GET | `/progress/student/:userId` | 🛡️ | A student's progress across courses |
| GET | `/progress/overview` | 🛡️ | Platform-wide progress overview |

#### `/payments`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/payments/create-order` | 👤 | Create a Razorpay order (rate-limited) |
| POST | `/payments/verify` | 👤 | Verify signature → enroll (rate-limited) |
| GET | `/payments/my` | 🔑 | Caller's payment history |
| GET | `/payments/history` | 🛡️ | All payments + total revenue |

#### `/site-config`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/site-config` | 🔓 | Current config (defaults if unset) |
| PUT | `/site-config` | 🛡️ | Update milestones/whyChooseUs/faqs |

#### `/scholarships`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/scholarships` | 👤 | Apply for a scholarship |
| GET | `/scholarships/my` | 👤 | Caller's applications |
| GET | `/scholarships` | 🛡️ | All applications (filters + pagination) |
| GET | `/scholarships/stats` | 🛡️ | Counts by status |
| PATCH | `/scholarships/:id/review` | 🛡️ | Approve (discount) / reject |

#### `/affiliates`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/affiliates/track/:code` | 🔓 | Increment a referral link's clicks |
| POST | `/affiliates/apply` | 🔓 | Apply to join the program |
| GET | `/affiliates/me` | 🔑 | Caller's affiliate dashboard |
| GET | `/affiliates/resources` | 🛡️ / affiliate | Marketing resources |
| POST | `/affiliates/resources` | 🛡️ | Add a resource |
| PATCH | `/affiliates/resources/:id` | 🛡️ | Update a resource |
| DELETE | `/affiliates/resources/:id` | 🛡️ | Delete a resource |
| GET | `/affiliates` | 🛡️ | All affiliates + summary |
| GET | `/affiliates/applications` | 🛡️ | List applications |
| PATCH | `/affiliates/applications/:id` | 🛡️ | Approve / reject (audited) |
| GET | `/affiliates/commissions` | 🛡️ | All commissions |
| PATCH | `/affiliates/commissions/:id` | 🛡️ | Set commission status (audited) |
| PATCH | `/affiliates/:userId` | 🛡️ | Update an affiliate's rate/status (audited) |

#### `/teaching-requests`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/teaching-requests` | 🎓 | Request to teach a course |
| GET | `/teaching-requests/my` | 🎓 | Caller's requests |
| GET | `/teaching-requests` | 🛡️ | All requests |
| PATCH | `/teaching-requests/:id` | 🛡️ | Approve / reject |
| DELETE | `/teaching-requests/:id` | 🛡️ / 🎓 | Cancel/remove a request |

#### `/batches`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/batches/my` | 🎓 | Batches assigned to caller |
| GET | `/batches/course/:courseId/options` | 🛡️ | Assignable instructors + offline students |
| GET | `/batches` | 🛡️ | All batches |
| POST | `/batches` | 🛡️ | Create a batch (notifies assignees) |
| PATCH | `/batches/:id` | 🛡️ | Update a batch |
| DELETE | `/batches/:id` | 🛡️ | Delete a batch |

#### `/attendance`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/attendance/my/:courseId` | 👤 | Caller's own attendance in a course |
| POST | `/attendance` | 🎓 / 🛡️ | Mark/upsert a session |
| GET | `/attendance?batchId=&date=` | 🎓 / 🛡️ | One session's records |
| GET | `/attendance/batch/:batchId` | 🎓 / 🛡️ | Session history + counts |

#### `/online-classes` (live Zoom/Meet classes)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/online-classes/student` | 👤 | Caller's upcoming live classes (+ their live courses) |
| GET | `/online-classes/instructor` | 🎓 | Live classes the caller teaches (+ approved-live courses) |
| GET | `/online-classes/:id/attendance` | 🎓 / 🛡️ | Roster + saved marks for a live session |
| POST | `/online-classes/:id/attendance` | 🎓 / 🛡️ | Upsert live-class attendance (time-windowed) |
| GET | `/online-classes/course/:courseId/options` | 🛡️ | Approved-live instructors + live batches for a course |
| GET | `/online-classes` | 🛡️ | All scheduled live classes |
| POST | `/online-classes` | 🛡️ | Schedule a live class (notifies instructor + audience) |
| PATCH | `/online-classes/:id` | 🛡️ | Update a live class (re-notifies on time/link/instructor change) |
| DELETE | `/online-classes/:id` | 🛡️ | Delete a live class (admin-password confirmed) |

#### `/sitemap.xml`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/sitemap.xml` | 🔓 | Dynamic sitemap built from published courses + static routes |

#### `/certificates` (admin)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/certificates/eligible` | 🛡️ | Students eligible for a certificate |
| POST | `/certificates/issue` | 🛡️ | Generate + email certificates (single/bulk, audited) |
| GET | `/certificates` | 🛡️ | List issued certificates |

#### `/mail` (admin)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/mail/send` | 🛡️ | Send a free-form email with attachments (rate-limited, audited) |

#### `/chat`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/chat` | 🔓➕ | AI support assistant (OpenAI, rate-limited; personalised if logged in) |

#### `/audit-logs` (admin)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/audit-logs` | 🛡️ | Paginated audit trail (filter `action`/`actorId`) |

#### `/blogs`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/blogs` | 🔓➕ | List posts (published; admin `?all=1` incl. drafts) |
| GET | `/blogs/:idOrSlug` | 🔓➕ | One post by slug or id |
| POST | `/blogs` | 🛡️ | Create (`multipart`, field `image`; audited) |
| PATCH | `/blogs/:id` | 🛡️ | Update (audited) |
| DELETE | `/blogs/:id` | 🛡️ | Delete (audited) |

#### `/testimonials`
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/testimonials` | 🔓➕ | List (scoped by `?courseId`; omit = global/homepage; admin `?all=1`) |
| POST | `/testimonials` | 🛡️ | Create (`multipart`, field `image`; audited) |
| PATCH | `/testimonials/:id` | 🛡️ | Update (audited) |
| DELETE | `/testimonials/:id` | 🛡️ | Delete (audited) |

> **Cross-cutting middleware:** public auth endpoints are rate-limited (`authLimiter`); `/mail`, `/payments`, and comment-like writes use `sensitiveLimiter`; all routes have a general flood limiter + `helmet` + `compression`. Privileged admin mutations are written to an append-only **audit log** (`/audit-logs`). Public read lists (courses, blogs, testimonials, site-config) are cached in Redis when `REDIS_URL` is set.

> **Destructive deletes are guarded** (`utils/deleteGuard.util.js`): deleting a batch or live class re-verifies the admin's password (sent in the request body as `password`) and refuses while dependents exist (e.g. recorded attendance, or live classes linked to a batch).

---

### 1. Auth — `/auth`

| Method | Path             | Auth | Description                          |
|--------|------------------|------|--------------------------------------|
| POST   | `/auth/register` | 🔓   | Register a student or instructor (sends email OTP) |
| POST   | `/auth/verify-email` | 🔓 | Verify email with a 6-digit OTP    |
| POST   | `/auth/resend-verification` | 🔓 | Re-send the email OTP        |
| POST   | `/auth/login`    | 🔓   | Log in, sets auth cookies            |
| POST   | `/auth/google`   | 🔓   | Sign in / sign up with a Google ID token |
| POST   | `/auth/forgot-password` | 🔓 | Email a password-reset code      |
| POST   | `/auth/verify-reset-code` | 🔓 | Validate a reset code          |
| POST   | `/auth/reset-password` | 🔓 | Set a new password with a code     |
| POST   | `/auth/logout`   | 🔓   | Clear auth cookies                   |
| POST   | `/auth/refresh`  | 🔓   | Issue a new access token from cookie |
| GET    | `/auth/me`       | 🔑   | Get the current authenticated user   |
| PATCH  | `/auth/complete-profile` | 🔑 | Fill phone/location after Google sign-up |
| PATCH  | `/auth/avatar`   | 🔑   | Upload/replace the caller's avatar   |
| POST   | `/auth/change-password` | 🔑 | Change the caller's password      |
| GET    | `/auth/users`    | 🛡️   | List users (filter `role`, `search` incl. roll, paginated) |

**Newer auth flows:**
- **Google sign-in** (`POST /auth/google`) verifies a Google ID token (`google-auth-library`, audience = `GOOGLE_CLIENT_ID`), finds-or-creates the user by email (linking `google_id`, marking verified), and issues the same cookies as login. New Google users have no phone/location → the client sends them through `PATCH /auth/complete-profile`.
- **Email verification** (`/auth/verify-email`, `/auth/resend-verification`) — a bcrypt-hashed 6-digit OTP with a 15-min expiry.
- **Password reset** (`/auth/forgot-password` → `/auth/verify-reset-code` → `/auth/reset-password`) — same OTP pattern; `forgot-password` always returns a generic message (no account enumeration), and a successful reset clears the refresh token (logs out other sessions).

#### POST `/auth/register`

Validated with Zod. `role` must be `student` or `instructor` (admin is rejected).

**Body**
```json
{
  "full_name": "Jane Doe",          // min 3, max 100 chars
  "email": "jane@example.com",       // valid email
  "password": "secret123",           // min 6 chars
  "role": "student",                 // "student" | "instructor"
  "phone": "9876543210",             // Indian mobile: ^[6-9]\d{9}$
  "location": "Patna, Bihar"         // 2–255 chars
}
```

**201** — a unique `roll_number` (`FSA-<ROLE>-<YY>-NNNN`) is assigned on registration.
```json
{ "statusCode": 201, "data": { "id": 12, "full_name": "Jane Doe", "email": "jane@example.com", "roll_number": "FSA-STU-26-0001", "role": "student", "avatar": null, "phone": "9876543210", "location": "Patna, Bihar", "created_at": "2026-06-05T..." }, "message": "User registered successfully", "success": true }
```

> An optional `referralCode` in the body attributes the signup to an affiliate
> (sets `referred_by`); invalid codes are ignored.

#### POST `/auth/login`

**Body**
```json
{ "email": "jane@example.com", "password": "secret123" }
```

**200** — also sets `accessToken` & `refreshToken` cookies.
```json
{ "statusCode": 200, "data": { "user": { "id": 12, "role": "student", "roll_number": "FSA-STU-26-0001", "...": "..." }, "accessToken": "<jwt>" }, "message": "Login successful", "success": true }
```

#### POST `/auth/logout`
Clears cookies. **200** `{ "data": {}, "message": "Logout successful" }`

#### POST `/auth/refresh`
Reads `refreshToken` cookie, validates against the stored token, issues a new `accessToken` cookie. **200** `{ "data": { "accessToken": "<jwt>" } }`

#### GET `/auth/me` 🔑
**200** — current user from PostgreSQL.
```json
{ "statusCode": 200, "data": { "id": 12, "full_name": "Jane Doe", "email": "jane@example.com", "roll_number": "FSA-STU-26-0001", "role": "student", "phone": "9876543210", "avatar": null, "is_verified": false, "is_active": true, "created_at": "2026-06-01T..." }, "message": "Current user fetched successfully", "success": true }
```

#### PATCH `/auth/avatar` 🔑
`multipart/form-data`, field name **`avatar`** (image, ≤ 5 MB enforced client-side). Uploads to Cloudinary (folder `avatars`, deterministic `public_id` per user so re-uploads overwrite), saves the URL to `users.avatar`, and returns the updated user.
**200** → `{ ...user, "avatar": "https://res.cloudinary.com/.../avatars/user_12.jpg" }`.

---

### 2. Courses — `/courses`

> ⚠️ The entire course router is behind `verifyJWT` — **all course endpoints require a logged-in user.** Non-admins only ever see published courses.

| Method | Path                 | Auth  | Description                               |
|--------|----------------------|-------|-------------------------------------------|
| POST   | `/courses`           | 🛡️    | Create a course (optional thumbnail)      |
| GET    | `/courses`           | 🔑    | List courses (published only for non-admin)|
| GET    | `/courses/:courseId` | 🔑    | Get one course with modules & materials   |
| PATCH  | `/courses/:courseId` | 🛡️    | Update a course (optional new thumbnail)  |
| DELETE | `/courses/:courseId` | 🛡️    | Delete course + its modules/materials     |

#### POST `/courses` 🛡️
`multipart/form-data` (so the optional thumbnail file can be attached).

**Fields**
| Field        | Type   | Required | Notes                                   |
|--------------|--------|----------|-----------------------------------------|
| `title`      | string | ✅       |                                         |
| `description`| string | ✅       |                                         |
| `category`   | string | ✅       |                                         |
| `level`      | string | ❌       | `beginner`\|`intermediate`\|`advanced`  |
| `price`      | number | ❌       | defaults `0`                            |
| `thumbnail`  | file   | ❌       | image, field name `thumbnail`           |

**201** → created course document.

#### GET `/courses` 🔑
**Query:** `page` (default 1), `limit` (default 10), `search` (matches title/category/description, case-insensitive). Non-admins are forced to `isPublished: true`. Module list is excluded from this view.

**200**
```json
{ "statusCode": 200, "data": { "courses": [ { "_id": "...", "title": "Full-Stack Dev", "category": "Development", "level": "intermediate", "price": 0, "isPublished": true } ], "total": 1, "page": 1, "limit": 10 }, "message": "Success", "success": true }
```

#### GET `/courses/:courseId` 🔑
Returns the course with `modules` populated, each with their `materials`. Non-admins get **403** if the course is not published.

#### PATCH `/courses/:courseId` 🛡️
`multipart/form-data`. Updatable fields: `title`, `description`, `category`, `level`, `price`, `isPublished`. Send a new `thumbnail` file to replace the image (old one is removed from Cloudinary).

#### DELETE `/courses/:courseId` 🛡️
Cascades — deletes all modules, their materials, and the Cloudinary assets. **200** `{ "data": null, "message": "Course deleted successfully" }`

---

### 3. Modules (nested under courses)

| Method | Path                                    | Auth | Description            |
|--------|-----------------------------------------|------|------------------------|
| POST   | `/courses/:courseId/modules`            | 🛡️   | Add a module           |
| GET    | `/courses/:courseId/modules`            | 🔑   | List modules + materials|
| PATCH  | `/courses/:courseId/modules/:moduleId`  | 🛡️   | Update a module        |
| DELETE | `/courses/:courseId/modules/:moduleId`  | 🛡️   | Delete module + materials|

#### POST `/courses/:courseId/modules` 🛡️
**Body**
```json
{ "title": "Introduction", "description": "Course overview", "order": 0 }
```
`title` required; `order` defaults to the current module count. **201** → module.

#### GET `/courses/:courseId/modules` 🔑
**200** → array of modules (sorted by `order`) with `materials` populated.

#### PATCH `/courses/:courseId/modules/:moduleId` 🛡️
**Body** — any module fields (`title`, `description`, `order`). **200** → updated module.

#### DELETE `/courses/:courseId/modules/:moduleId` 🛡️
Removes the module, its materials, and the Cloudinary files. **200** `{ "data": null }`

---

### 4. Materials (nested under modules)

| Method | Path                                                                | Auth | Description                |
|--------|---------------------------------------------------------------------|------|----------------------------|
| POST   | `/courses/:courseId/modules/:moduleId/materials`                    | 🛡️   | Upload up to 10 files      |
| DELETE | `/courses/:courseId/modules/:moduleId/materials/:materialId`        | 🛡️   | Delete a material          |

#### POST `.../materials` 🛡️
`multipart/form-data`. Field name **`files`** (max 10). Supported types: **video**, **pdf**, **image** (inferred from MIME type).

**Optional titles:** send a `titles` field as a JSON array string (`'["Intro","Notes"]'`) or a comma-separated list. Each title maps to the file at the same index; falls back to the original filename.

**201**
```json
{ "statusCode": 201, "data": [ { "_id": "...", "title": "Intro", "type": "video", "url": "https://res.cloudinary.com/...", "duration": 312, "size": 10485760 } ], "message": "1 material(s) uploaded successfully", "success": true }
```

#### DELETE `.../materials/:materialId` 🛡️
Removes the Cloudinary asset and the DB record. **200** `{ "data": null }`

---

### 5. Reviews & Testimonials (nested under courses)

| Method | Path                                       | Auth | Description                              |
|--------|--------------------------------------------|------|------------------------------------------|
| GET    | `/courses/:courseId/reviews`               | 🔑   | Paginated reviews + average rating       |
| GET    | `/courses/:courseId/reviews/testimonials`  | 🔑   | Featured reviews only                    |
| POST   | `/courses/:courseId/reviews`               | 👤   | Add/update own review (must be enrolled) |
| DELETE | `/courses/:courseId/reviews`               | 🔑   | Delete own review (admin: any via query) |
| PATCH  | `/courses/:courseId/reviews/featured`      | 🛡️   | Toggle a review's testimonial flag       |

#### GET `/courses/:courseId/reviews` 🔑
**Query:** `page` (1), `limit` (10). **200**
```json
{ "statusCode": 200, "data": { "reviews": [ { "userId": "uuid", "rating": 5, "comment": "Great!", "isFeatured": false, "createdAt": "...", "user": { "id": "uuid", "full_name": "Jane", "avatar": null } } ], "total": 1, "averageRating": 5, "page": 1, "limit": 10 }, "success": true }
```

#### POST `/courses/:courseId/reviews` 👤
Caller must have an active enrollment. One review per user per course (re-posting updates it).
**Body** `{ "rating": 5, "comment": "Loved it" }` — `rating` 1–5 required.
**200** `{ "data": { "averageRating": 4.8, "totalReviews": 12 }, "message": "Review added" }`

#### DELETE `/courses/:courseId/reviews` 🔑
Deletes the caller's own review. **Admin** may delete anyone's by passing `?userId=<id>`. **200** `{ "data": null, "message": "Review deleted" }`

#### PATCH `/courses/:courseId/reviews/featured` 🛡️
**Body** `{ "userId": "uuid", "isFeatured": true }` — `userId` required; omit `isFeatured` to toggle. **200** → updated review.

---

### 6. Contact — `/contact`

Public-facing support entry point. Uses **optional auth** — works for guests, and tailors output for logged-in users.

| Method | Path               | Auth   | Description                                   |
|--------|--------------------|--------|-----------------------------------------------|
| GET    | `/contact/info`    | 🔓➕   | Phone/email/WhatsApp contact details          |
| POST   | `/contact/enquiry` | 🔓➕   | Submit an enquiry (creates a support ticket)  |

> Admins are blocked from both (they use the enquiry portal instead → **403**).

#### GET `/contact/info` 🔓➕
WhatsApp routing adapts to the caller (guest / instructor / enrolled student / guest student).
**200**
```json
{ "statusCode": 200, "data": { "phone": { "number": "+91...", "label": "Call Admin Directly", "link": "tel:+91..." }, "email": { "address": "admin@...", "label": "Email Us", "link": "mailto:admin@..." }, "whatsapp": { "number": "+91...", "type": "Guest Support", "prefilledMessage": "Hi! I am interested...", "link": "https://wa.me/..." } }, "success": true }
```

#### POST `/contact/enquiry` 🔓➕
Saves a ticket to MongoDB and emails a confirmation.
**Body**
```json
{
  "subject": "Course question",     // required
  "message": "How long is access?", // required
  "name": "Guest User",             // required for guests (auto-filled if logged in)
  "email": "guest@example.com",     // required for guests (auto-filled if logged in)
  "phone": "9876543210",            // optional
  "category": "general"             // optional: course_issue|payment|general|technical
}
```
**200**
```json
{ "statusCode": 200, "data": { "ticketId": "TKT-0001" }, "message": "Enquiry submitted! Your ticket ID is TKT-0001. We will get back to you within 24 hours.", "success": true }
```

---

### 7. Enquiries — `/enquiries` (admin)

> Entire router is `verifyJWT` + `requireRole("admin")`. **All endpoints are admin-only.**

| Method | Path                      | Auth | Description                              |
|--------|---------------------------|------|------------------------------------------|
| GET    | `/enquiries`              | 🛡️   | List enquiries (filters + pagination)    |
| GET    | `/enquiries/stats`        | 🛡️   | Dashboard counts & avg response time     |
| GET    | `/enquiries/:id`          | 🛡️   | One enquiry + reply history + links      |
| POST   | `/enquiries/:id/reply`    | 🛡️   | Reply (emails the user, marks contacted) |
| PATCH  | `/enquiries/:id/status`   | 🛡️   | Update status / priority / admin note    |

#### GET `/enquiries` 🛡️
**Query:** `page`, `limit`, `status`, `role`, `priority`, `category`, `search` (name/email/subject/ticketId). Replies are omitted from the list view.

#### GET `/enquiries/stats` 🛡️
**200** → `{ total, byStatus, byRole, byCategory, avgResponseTime }`.

#### GET `/enquiries/:id` 🛡️
**200** → `{ enquiry, contactLinks: { callLink, whatsappLink, mailLink } }`.

#### POST `/enquiries/:id/reply` 🛡️
**Body** `{ "message": "Thanks for reaching out..." }`. Appends an admin reply, sets status `contacted`, emails the user. Fails (**400**) if the enquiry is already `resolved`.

#### PATCH `/enquiries/:id/status` 🛡️
**Body** `{ "status": "resolved", "priority": "high", "adminNote": "Called back" }` — all optional. Setting `resolved` stamps `respondedAt`.

---

### 8. Enrollments — `/enrollments`

> Entire router behind `verifyJWT`.

| Method | Path                                      | Auth        | Description                          |
|--------|-------------------------------------------|-------------|--------------------------------------|
| GET    | `/enrollments/my-courses`                 | 🔑          | Caller's enrolled courses + progress |
| POST   | `/enrollments`                            | 🛡️          | Enroll a student into a course       |
| DELETE | `/enrollments/:enrollmentId`              | 🛡️          | Unenroll (soft delete)               |
| GET    | `/enrollments/course/:courseId/students`  | 🛡️ / 🎓     | Students in a course (+ progress)    |
| GET    | `/enrollments/student/:userId`            | 🛡️          | All courses a student is enrolled in |
| GET    | `/enrollments/unenrolled-students`        | 🛡️          | Students with **no** active enrollment |
| POST   | `/enrollments/broadcast`                  | 🛡️          | Bulk-email students                  |

#### GET `/enrollments/unenrolled-students` 🛡️
**Query:** `search` (name/email/roll). Cross-references PostgreSQL students against active Mongo enrollments. **200** → `{ students: [ { id, full_name, email, roll_number, phone, location, avatar, created_at } ], total }`.

#### POST `/enrollments/broadcast` 🛡️
**Body** `{ "subject", "message", "userIds"? }`. Emails the given students (each greeted by name; newlines preserved); if `userIds` is omitted it targets **all** students with no active enrollment. Restricted to `role = student`. **200** → `{ sent, failed, total }`.

#### GET `/enrollments/my-courses` 🔑
**200** → array of `{ enrollmentId, enrolledAt, course, progress: { completionPercent, lastAccessedAt } }`.

#### POST `/enrollments` 🛡️
**Body** `{ "userId": 12, "courseId": "<ObjectId>" }`. The target user must exist in PostgreSQL and be a `student`. Re-enrolls (re-activates) a previously unenrolled student. Creates an empty progress doc on first enrollment.
- **201** → enrollment created · **200** → re-enrolled · **409** → already enrolled.

#### DELETE `/enrollments/:enrollmentId` 🛡️
Soft delete (`isActive=false`, stamps `unenrolledAt`) — keeps progress history. **200**.

#### GET `/enrollments/course/:courseId/students` 🛡️ / 🎓
**Query:** `page` (1), `limit` (20). Instructors may only view their own courses (else **403**). **200** → `{ students: [ { enrollmentId, enrolledAt, user, progress } ], total, page, limit }`.

#### GET `/enrollments/student/:userId` 🛡️
**200** → array of `{ enrollmentId, enrolledAt, course, progress }` for that student.

---

### 9. Progress — `/progress`

> Entire router behind `verifyJWT`.

| Method | Path                            | Auth        | Description                                 |
|--------|---------------------------------|-------------|---------------------------------------------|
| POST   | `/progress/mark-watched`        | 👤          | Mark a material watched/completed           |
| GET    | `/progress/my-progress/:courseId`| 🔑         | Caller's detailed progress in a course      |
| GET    | `/progress/course/:courseId`    | 🛡️ / 🎓     | All students' progress in a course          |
| GET    | `/progress/student/:userId`     | 🛡️          | A student's progress across all courses     |
| GET    | `/progress/overview`            | 🛡️          | Platform-wide progress overview             |

#### POST `/progress/mark-watched` 👤
Caller must be enrolled & active in the course.
**Body**
```json
{ "courseId": "<ObjectId>", "materialId": "<ObjectId>", "watchPercent": 100 }
```
Recomputes `completionPercent` (unique materials watched ÷ total materials). Sets `completedAt` when it reaches 100%.
**200** → `{ completionPercent, completedAt, totalMaterials, completedMaterials }`.

#### GET `/progress/my-progress/:courseId` 🔑
Per-module breakdown with each material's `isCompleted` flag.
**200** → `{ courseId, courseTitle, completionPercent, lastAccessedAt, completedAt, enrolledAt, moduleBreakdown: [...] }`.

#### GET `/progress/course/:courseId` 🛡️ / 🎓
**Query:** `page` (1), `limit` (20). Instructors restricted to their own courses. **200** → `{ courseTitle, totalMaterials, summary: { totalEnrolled, avgCompletionPercent, fullyCompleted, inProgress }, students: [...], page, limit, total }`.

#### GET `/progress/student/:userId` 🛡️
**200** → array of `{ courseId, courseTitle, courseThumbnail, category, completionPercent, lastAccessedAt, completedAt, enrolledAt }`.

#### GET `/progress/overview` 🛡️
Aggregated per-course stats. **200** → array of `{ courseId, courseTitle, totalStudents, avgCompletion, completed, neverStarted, completionRate }`.

---

### 10. Payments — `/payments`

> Entire router behind `verifyJWT`. Uses **Razorpay** (orders + signature verify).
> Amounts are stored in **paise** in PostgreSQL and returned as **rupees** in admin totals.

| Method | Path                      | Auth | Description                                   |
|--------|---------------------------|------|-----------------------------------------------|
| POST   | `/payments/create-order`  | 👤   | Create a Razorpay order for a course          |
| POST   | `/payments/verify`        | 👤   | Verify signature → enroll + email + commission|
| GET    | `/payments/my`            | 🔑   | Caller's own payment history                   |
| GET    | `/payments/history`       | 🛡️   | All payments + total revenue                   |

#### POST `/payments/create-order` 👤
**Body** `{ "courseId": "<ObjectId>", "enrollmentType": "self-paced" }` — `enrollmentType` is `self-paced`|`classroom`|`live` (picks `priceOnline`/`priceOffline`/`priceLive`; defaults to `self-paced`). The chosen mode must be in the course's `modes` (**400** otherwise). Returns a pending order (reuses an existing pending one for the same course+type). Rejects if already enrolled (**409**) or price unset (**400**). Returns **503** if Razorpay keys are missing.
**200** → `{ orderId, amount, currency, keyId, courseName, enrollmentType }` (amount in paise).

#### POST `/payments/verify` 👤
**Body** `{ "razorpay_order_id", "razorpay_payment_id", "razorpay_signature" }`. Verifies the HMAC-SHA256 signature; on success marks the payment `paid`, enrolls (or re-activates) the student, creates Progress, bumps the course counter, records an affiliate commission if the buyer was referred, and emails a confirmation. Idempotent. Invalid signature → payment `failed` + **400**.
**200** → `{ courseId, paymentId, enrollmentType }`.

#### GET `/payments/my` 🔑
**200** → array of the caller's payments (newest first).

#### GET `/payments/history` 🛡️
**Query:** `page` (1), `limit` (20), `status`. **200** → `{ payments: [ { ...payment, full_name, email, phone } ], total, page, limit, totalRevenue }` (`totalRevenue` in rupees).

---

### 11. Affiliates — `/affiliates`

Referral program. Applications are public; everything else needs auth. Money is
stored in **paise**, returned in **rupees**.

| Method | Path                              | Auth          | Description                                      |
|--------|-----------------------------------|---------------|--------------------------------------------------|
| GET    | `/affiliates/track/:code`         | 🔓            | Increment a referral link's click counter        |
| POST   | `/affiliates/apply`               | 🔓            | Apply to join the program (no account created)    |
| GET    | `/affiliates/me`                  | 🔑            | Caller's affiliate dashboard (stats, commissions) |
| GET    | `/affiliates/resources`           | 🛡️ / `affiliate` | Marketing resources (affiliate: active only)   |
| POST   | `/affiliates/resources`           | 🛡️            | Add a resource                                   |
| PATCH  | `/affiliates/resources/:id`       | 🛡️            | Update a resource                                |
| DELETE | `/affiliates/resources/:id`       | 🛡️            | Delete a resource                                |
| GET    | `/affiliates`                     | 🛡️            | All affiliates + platform summary                |
| GET    | `/affiliates/applications`        | 🛡️            | List applications (`?status=`) + counts          |
| PATCH  | `/affiliates/applications/:id`    | 🛡️            | Approve (→ create affiliate user) / reject        |
| GET    | `/affiliates/commissions`         | 🛡️            | All commissions (`?status=`, paginated)          |
| PATCH  | `/affiliates/commissions/:id`     | 🛡️            | Set commission status (`pending`/`approved`/`paid`)|
| PATCH  | `/affiliates/:userId`             | 🛡️            | Update an affiliate's rate/type/status           |

#### POST `/affiliates/apply` 🔓
**Body** `{ "full_name", "email", "phone"?, "bio"?, "social_links"?: [ { "platform", "url" } ] }`. Stores a `pending` application. **409** if an affiliate already exists for the email or a pending application exists. **201** → `{ id, full_name, email, status, created_at }`.

#### GET `/affiliates/me` 🔑
**200** → `{ isAffiliate: false }` for non-affiliates, otherwise `{ isAffiliate: true, code, referralLink, commissionType, commissionValue, status, clicks, stats: { referredUsers, totalSales, totalEarned, pending, approved, paid }, commissions: [...] }` (amounts in rupees).

#### PATCH `/affiliates/applications/:id` 🛡️
**Body** `{ "action": "approve" | "reject", "review_note"? }`. **Approve** creates an `affiliate`-role user with a temporary password + unique referral code (`FSA-XXXXXX`) and emails the credentials. **Reject** stores the note and emails the applicant. **409** if already reviewed.

#### PATCH `/affiliates/:userId` 🛡️
**Body** `{ "commission_type"?: "percent"|"flat", "commission_value"?, "status"?: "active"|"suspended" }` — all optional (COALESCE update).

---

### 12. Scholarships — `/scholarships`

> Entire router behind `verifyJWT`.

| Method | Path                          | Auth | Description                                  |
|--------|-------------------------------|------|----------------------------------------------|
| POST   | `/scholarships`               | 👤   | Apply for a scholarship on a course          |
| GET    | `/scholarships/my`            | 👤   | Caller's own applications                     |
| GET    | `/scholarships`               | 🛡️   | All applications (filters + pagination)       |
| GET    | `/scholarships/stats`         | 🛡️   | Counts by status                             |
| PATCH  | `/scholarships/:id/review`    | 🛡️   | Approve (with discount) / reject / review     |

#### POST `/scholarships` 👤
**Body** `{ "track", "courseId", "statement", "income"? }` — `track` ∈ `merit|need|women|early`; `statement` required. **409** if an active application already exists for that course. **201** → application.

#### GET `/scholarships` 🛡️
**Query:** `page` (1), `limit` (20), `status`, `track`, `search` (applicant name/email). **200** → `{ applications: [ { ...application, applicant } ], total, page, limit }`.

#### GET `/scholarships/stats` 🛡️
**200** → `{ pending, under_review, approved, rejected, total }`.

#### PATCH `/scholarships/:id/review` 🛡️
**Body** `{ "status": "under_review"|"approved"|"rejected", "discountPercent"?, "adminNote"? }`. Approval **requires** `discountPercent` (1–100). **200** → updated application.

---

### 13. Teaching Requests — `/teaching-requests`

> Entire router behind `verifyJWT`. Instructors ask to teach a course in a specific
> **delivery mode**; admins approve. A request is **per `(instructor, course, mode)`** —
> an instructor applies separately for each mode they want to teach. Approval is the
> prerequisite for being assigned to a [classroom/live batch](#14-batches----batches)
> or a [live class](#23-online-classes----online-classes) in that mode.

| Method | Path                       | Auth            | Description                                |
|--------|----------------------------|-----------------|--------------------------------------------|
| POST   | `/teaching-requests`       | 🎓              | Request to teach a course in a mode         |
| GET    | `/teaching-requests/my`    | 🎓              | Caller's own requests                       |
| GET    | `/teaching-requests`       | 🛡️              | All requests (`?status=`, paginated)       |
| PATCH  | `/teaching-requests/:id`   | 🛡️              | Approve / reject                           |
| DELETE | `/teaching-requests/:id`   | 🛡️ / 🎓 (own)   | Admin removes · instructor withdraws        |

#### POST `/teaching-requests` 🎓
**Body** `{ "courseId", "mode"?, "message"? }` — `mode` ∈ `self-paced|classroom|live` (default `classroom`) and must be one of the course's offered `modes` (**400** otherwise). For the same `(instructor, course, mode)`:
- **pending** or **approved** already exists → **409**.
- **rejected**, or **withdrawn** with the hold elapsed → the row is re-opened to `pending` (**200**, `reSubmitted: true`).
- **withdrawn** within the last **30 days** (`WITHDRAW_HOLD_DAYS`) → **403** with the date they may re-apply.

Otherwise a new request is created (**201**).

#### PATCH `/teaching-requests/:id` 🛡️
**Body** `{ "status": "approved" | "rejected" }` (stamps `reviewedBy`/`reviewedAt`). **200** → request.

#### DELETE `/teaching-requests/:id` 🛡️ / 🎓
- **Instructor (own):** soft **withdraw** — status → `withdrawn`, stamps `withdrawnAt`, and starts the 30-day re-apply hold. **200** → `{ withdrawn: true, holdUntil }`.
- **Admin:** hard **delete** (admin-password confirmed via `{ "password" }`). If the request is `approved`, the delete is refused while the instructor still has dependents for that mode — `classroom` → batches, `live` → live classes (`self-paced` has none) — which must be reassigned/removed first. **200** → `{ deleted: true }`.

---

### 14. Batches — `/batches`

> Entire router behind `verifyJWT`. A batch groups students under one instructor + schedule for a single delivery mode — `classroom` (in-person) or `live` (Zoom/Meet). The instructor must hold an **approved teaching request for that mode**, and every student must be enrolled in that same mode.

| Method | Path                                | Auth | Description                                          |
|--------|-------------------------------------|------|-----------------------------------------------------|
| GET    | `/batches/my`                       | 🎓   | Batches assigned to the caller (instructor)         |
| GET    | `/batches/course/:courseId/options` | 🛡️   | Assignable instructors + offline students for a course|
| GET    | `/batches`                          | 🛡️   | All batches (course + instructor + students)        |
| POST   | `/batches`                          | 🛡️   | Create a batch (emails instructor + students)       |
| PATCH  | `/batches/:id`                      | 🛡️   | Update a batch (re-notifies on assignment changes)  |
| DELETE | `/batches/:id`                      | 🛡️   | Delete a batch                                       |

#### GET `/batches/course/:courseId/options` 🛡️
**Query:** `mode` (`classroom` default | `live`). **200** → `{ course: { id, title }, instructors: [...], students: [...] }` — instructors with an **approved** teaching request **for that mode**, and **active enrollees in that mode**.

#### POST `/batches` 🛡️
**Body** `{ "name", "courseId", "instructorId", "studentIds"?: [], "mode"?, "schedule"?, "location"?, "seats"?, "status"? }` — `mode` is `classroom` (default) or `live`. Validates the instructor is approved for that mode and every student is enrolled in it (**400** otherwise). Emails the schedule/location to all assigned. **201** → batch.

#### PATCH `/batches/:id` 🛡️
Same fields (course **and** mode are fixed once created). Re-validates against the batch's mode if instructor/roster changes; re-notifies when assignment, schedule, or location changes. **200** → batch.

#### DELETE `/batches/:id` 🛡️
Admin-password confirmed (`{ "password" }` in the body). Refuses while the batch has recorded attendance or any live class linked to it. **200**.

---

### 15. Attendance — `/attendance`

> Entire router behind `verifyJWT` + `requireRole("instructor", "admin")`.
> This router covers **classroom** attendance — one session = one batch on one calendar day; instructors are limited to their own batches. **Live-class** attendance is taken separately under [`/online-classes/:id/attendance`](#23-online-classes----online-classes).

| Method | Path                         | Auth        | Description                               |
|--------|------------------------------|-------------|-------------------------------------------|
| POST   | `/attendance`                | 🎓 / 🛡️     | Mark/upsert a session                     |
| GET    | `/attendance?batchId=&date=` | 🎓 / 🛡️     | One session's records (with names)        |
| GET    | `/attendance/batch/:batchId` | 🎓 / 🛡️     | Session history + counts for a batch      |

#### POST `/attendance` 🎓 / 🛡️
**Body** `{ "batchId", "date": "YYYY-MM-DD", "records": [ { "studentId", "status" } ] }` — `status` ∈ `present|absent|leave`. Every `studentId` must be on the batch roster. Upserts the session (re-marking the same day overwrites). **200** → session.

#### GET `/attendance?batchId=&date=` 🎓 / 🛡️
**200** → `{ batchId, date, markedBy, records: [ { studentId, status, full_name, email } ] }`, or `null` if not yet marked.

#### GET `/attendance/batch/:batchId` 🎓 / 🛡️
**200** → `{ batch: { id, name, course, studentCount }, sessions: [ { date, total, present, absent, leave, markedBy, updatedAt } ] }`.

---

### 16. Site Config — `/site-config`

Public marketing content (homepage milestones, "why choose us", FAQs).

| Method | Path           | Auth | Description                                     |
|--------|----------------|------|-------------------------------------------------|
| GET    | `/site-config` | 🔓   | Current config (built-in defaults if unset)     |
| PUT    | `/site-config` | 🛡️   | Replace `milestones` / `whyChooseUs` / `faqs`   |

#### PUT `/site-config` 🛡️
**Body** any of `{ "milestones": [...], "whyChooseUs": [...], "faqs": [...] }` (only provided keys are updated; upserts the single config doc). **200** → updated config.

---

### 17. Certificates — `/certificates` (admin)

> Entire router behind `verifyJWT` + `requireRole("admin")`.

| Method | Path                     | Auth | Description                                  |
|--------|--------------------------|------|----------------------------------------------|
| GET    | `/certificates/eligible` | 🛡️   | Students who qualify for a certificate        |
| POST   | `/certificates/issue`    | 🛡️   | Generate + email PDF certificate(s)           |
| GET    | `/certificates`          | 🛡️   | List issued certificates                      |

Eligibility by mode: **self-paced** requires 100% progress; **classroom** requires attending ≥75% of `course.totalClasses`; **live** requires attending ≥75% of `course.totalLiveClasses`. `POST /certificates/issue` accepts `{ "items": [ { "userId", "courseId" } ] }` (single or bulk), generates a PDF per student, emails it, and records the certificate (idempotent — re-issuing re-sends). Audited as `certificate.issue`.

---

### 18. Mail — `/mail` (admin)

| Method | Path         | Auth | Description                                       |
|--------|--------------|------|---------------------------------------------------|
| POST   | `/mail/send` | 🛡️   | Send a free-form email with optional attachments  |

`multipart/form-data` — `{ to, subject, message }` + up to 5 files (field `attachments`). Rate-limited (`sensitiveLimiter`) and audited as `mail.send`.

---

### 19. Chat — `/chat`

| Method | Path    | Auth  | Description                                  |
|--------|---------|-------|----------------------------------------------|
| POST   | `/chat` | 🔓➕  | "Fillip Support" AI assistant (OpenAI)        |

**Body** `{ "messages": [ { "role", "content" } ] }`. Uses tool-calling scoped to Fillip topics; personalises answers when the caller is logged in (`optionalAuth`). Rate-limited per user/IP (`chatLimiter`). Degrades to a canned reply if `OPENAI_API_KEY` is unset.

---

### 20. Audit Logs — `/audit-logs` (admin)

| Method | Path          | Auth | Description                                |
|--------|---------------|------|--------------------------------------------|
| GET    | `/audit-logs` | 🛡️   | Paginated audit trail                       |

**Query:** `page`, `limit` (≤200), `action`, `actorId`. Returns append-only records of privileged actions (`enrollment.*`, `mail.send`, `certificate.issue`, `affiliate.*`, `blog.*`, `testimonial.*`) with actor, target, sanitized metadata, IP, and timestamp (joined to the actor's name/email). Written fire-and-forget by the `audit()` middleware on successful mutations.

---

### 21. Blogs — `/blogs`

| Method | Path               | Auth  | Description                                  |
|--------|--------------------|-------|----------------------------------------------|
| GET    | `/blogs`           | 🔓➕  | List posts (published; admin `?all=1`)        |
| GET    | `/blogs/:idOrSlug` | 🔓➕  | One post by slug or Mongo id                  |
| POST   | `/blogs`           | 🛡️   | Create a post                                 |
| PATCH  | `/blogs/:id`       | 🛡️   | Update a post                                 |
| DELETE | `/blogs/:id`       | 🛡️   | Delete a post (+ Cloudinary cover)            |

**Query (list):** `page`, `limit`, `search`, `category`. Writes are `multipart/form-data` with an optional cover image (field **`image`**); slug, excerpt, and read-time auto-derive from title/content if not supplied; `isPublished` toggles draft vs live. Public reads are Redis-cached; writes are audited (`blog.*`).

---

### 22. Testimonials — `/testimonials`

| Method | Path                 | Auth  | Description                                            |
|--------|----------------------|-------|--------------------------------------------------------|
| GET    | `/testimonials`      | 🔓➕  | List testimonials — scoped by `?courseId` (omit = global/homepage); admin `?all=1` for every course incl. drafts |
| POST   | `/testimonials`      | 🛡️   | Create a testimonial                                   |
| PATCH  | `/testimonials/:id`  | 🛡️   | Update a testimonial                                   |
| DELETE | `/testimonials/:id`  | 🛡️   | Delete a testimonial (+ Cloudinary avatar)             |

Fields: `name`, `role`, `quote`, optional `rating` (1–5), `order`, `isPublished`, optional avatar (`multipart`, field **`image`**), and optional **`courseId`** (`null` = homepage/global; set = shown on that course page). Course pages combine these admin-authored testimonials with **featured student reviews** (`GET /courses/:id/reviews/testimonials`). Public reads are Redis-cached per scope; writes are audited (`testimonial.*`).

---

### 23. Online Classes — `/online-classes`

> Entire router behind `verifyJWT`. Scheduled **live** sessions delivered over Zoom / Google Meet, attached to a course and (optionally) a `live` batch. When a `batchId` is set the class is visible — and attendance taken — only for that batch's students; otherwise it is course-wide (every student with an active **live** enrollment).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET    | `/online-classes/student` | 👤 | Caller's live classes + their live courses |
| GET    | `/online-classes/instructor` | 🎓 | Live classes the caller teaches + approved-live courses |
| GET    | `/online-classes/:id/attendance` | 🎓 / 🛡️ | Roster + saved marks for a live session |
| POST   | `/online-classes/:id/attendance` | 🎓 / 🛡️ | Upsert live-class attendance (time-windowed) |
| GET    | `/online-classes/course/:courseId/options` | 🛡️ | Approved-live instructors + live batches for a course |
| GET    | `/online-classes` | 🛡️ | All scheduled live classes (newest first) |
| POST   | `/online-classes` | 🛡️ | Schedule a live class |
| PATCH  | `/online-classes/:id` | 🛡️ | Update a live class |
| DELETE | `/online-classes/:id` | 🛡️ | Delete a live class (admin-password confirmed) |

#### POST `/online-classes` 🛡️
**Body** `{ "title", "courseId", "instructorId", "joinUrl", "startTime", "batchId"?, "meetingId"?, "passcode"?, "durationMins"?, "status"? }`. `title`, `courseId`, `instructorId`, `joinUrl`, `startTime` are required. The instructor must hold an **approved `live` teaching request** for the course; an optional `batchId` must be a `live` batch of that course (**400** otherwise). Emails the join link/schedule to the instructor + audience. **201** → class.

#### GET `/online-classes/student` 👤 & `/online-classes/instructor` 🎓
Each returns `{ courses, classes }` — `courses` lets a course appear in the client's filter sub-nav even before any session is scheduled. Students see non-cancelled classes for their live-enrolled courses (batch-scoped classes only if they're on that batch). Instructors see classes they teach + their approved-live courses.

#### GET / POST `/online-classes/:id/attendance` 🎓 / 🛡️
Caller must be the assigned instructor or an admin. Attendance is **time-windowed**: it can't be marked **before** the class starts; the **instructor** marks it **during** `[start, start + durationMins]`; **after** it ends only an **admin** can set or correct it. `GET` returns `{ onlineClass, roster, marked, canMark, markPhase, markReason }`; `POST` body is `{ "records": [ { "studentId", "status" } ] }` (`status` ∈ `present|absent|leave`) and upserts the single session record (stored in the shared Attendance collection, keyed by `onlineClassId`).

#### DELETE `/online-classes/:id` 🛡️
Admin-password confirmed (`{ "password" }`). Refuses once attendance has been recorded for the session. **200**.

---

## Data Models

### PostgreSQL — `users`
Authoritative store for identity. Referenced from Mongo documents by `userId`.

| Column        | Notes                                                          |
|---------------|----------------------------------------------------------------|
| `id`          | UUID primary key (referenced as `userId` in Mongo)             |
| `full_name`   |                                                                |
| `email`       | Unique                                                         |
| `roll_number` | Unique — `FSA-<ROLE>-<YY>-NNNN` (see [Roll numbers](#roll-numbers)) |
| `password`    | bcrypt hash                                                    |
| `role`        | `student` \| `instructor` \| `admin` \| `affiliate`           |
| `phone`       |                                                                |
| `location`    |                                                                |
| `avatar`      | Nullable (Cloudinary URL)                                      |
| `referred_by` | Nullable — affiliate's user id that referred this signup       |
| `is_verified` | Boolean                                                        |
| `is_active`   | Boolean                                                        |
| `refresh_token`| Current refresh token (validated on refresh)                  |
| `created_at`  |                                                                |

> Other PostgreSQL tables: `affiliate_applications`, `affiliates`
> (`code`, `commission_type`, `commission_value`, `status`, `clicks`),
> `affiliate_resources`, `commissions` (`affiliate_user_id`, `referred_user_id`,
> `sale_amount`, `commission_amount` in paise, `status`), and `payments`
> (`razorpay_order_id`/`_payment_id`, `enrollment_type`, `amount` in paise,
> `status` `pending`/`paid`/`failed`).

### MongoDB (Mongoose)

#### Course
```
title*        String
description*  String
category*     String
level         "beginner" | "intermediate" | "advanced"  (default "beginner")
modes         ["self-paced" | "classroom" | "live"]  (default ["self-paced","classroom"])
price         Number (default 0)
priceOnline   Number  (self-paced price)
priceOffline  Number  (classroom price)
priceLive     Number  (live price)
thumbnail / thumbnailPublicId   String  (Cloudinary)
slug          String  (unique, sparse — used for /course/:slug URLs)
isPublished   Boolean (default false)   (requires a price on ≥1 mode)
createdBy     String   (PG user id)
modules       [ObjectId → Module]
prerequisites / benefits / targetAudience   [String]
language      String (default "English")
totalDuration / totalStudentsEnrolled       Number
totalClasses    Number  (planned classroom sessions — certificate denominator)
totalLiveClasses Number (planned live sessions — certificate denominator)
viewCount     Number  (detail-page opens — powers "Trending")
averageRating / totalReviews                Number
reviews       [{ userId, rating 1–5, comment, isFeatured, createdAt }]
course-page display: tag, subtitle, tagline, heroImg, highlights[],
                     learnPoints[], industry{}, faqs[], demandReasons[], whyChooseUs[]
timestamps
```

#### Module
```
title*        String
description   String
course*       ObjectId → Course
order         Number (default 0)
materials     [ObjectId → Material]
timestamps
```

#### Material
```
title*    String
type*     "pdf" | "image" | "video"
url*      String  (Cloudinary URL)
publicId* String  (Cloudinary id, used for deletion)
module*   ObjectId → Module
order     Number
duration  Number (seconds, videos)
size      Number (bytes)
timestamps
```

#### Enrollment
```
userId*        String  (PG user UUID)
courseId*      ObjectId → Course
enrolledBy*    String  (PG UUID — admin, or the student on self-purchase)
enrollmentType "self-paced" | "classroom" | "live"  (default "self-paced")
isActive       Boolean (default true)
unenrolledAt   Date
timestamps
unique index: { userId, courseId }
```

#### Progress
```
userId*            Number  (PG user id)
courseId*          ObjectId → Course
completedMaterials [{ materialId, watchedAt, watchPercent 0–100 }]
completionPercent  Number 0–100 (default 0)
lastAccessedAt     Date
completedAt        Date (set at 100%)
timestamps
unique index: { userId, courseId }
```

#### Enquiry
```
ticketId   String  (auto: "TKT-0001", "TKT-0002", ...)
name*      String
email*     String
phone      String
subject*   String
message*   String
role       "guest" | "student" | "instructor"  (default "guest")
status     "pending" | "contacted" | "resolved"  (default "pending")
priority   "low" | "medium" | "high" | "urgent"  (default "medium")
category   "course_issue" | "payment" | "general" | "technical"  (default "general")
adminNote  String
replies    [{ message, sentBy: "user"|"admin", sentAt }]
respondedAt Date
timestamps
```

#### Scholarship
```
userId*         String  (PG user UUID)
track*          "merit" | "need" | "women" | "early"
courseId*       ObjectId → Course
statement*      String
income          String
documents       [{ url, publicId }]
status          "pending" | "under_review" | "approved" | "rejected"  (default "pending")
discountPercent Number 0–100 (set by admin on approval)
used            Boolean (flips true after a discounted payment)
adminNote       String
reviewedBy      String (admin PG UUID)   reviewedAt  Date
timestamps
```

#### TeachingRequest
```
instructorId*  String  (PG user UUID, role instructor)
courseId*      ObjectId → Course
message        String
mode*          "self-paced" | "classroom" | "live"  (default "classroom")
status         "pending" | "approved" | "rejected" | "withdrawn"  (default "pending")
reviewedBy     String (admin PG UUID)   reviewedAt  Date
withdrawnAt    Date  (drives a re-apply hold after self-withdrawal)
timestamps
unique index: { instructorId, courseId, mode }  (one request per instructor+course+mode)
```

#### Batch
```
name*         String
courseId*     ObjectId → Course
instructorId* String  (PG UUID — must have an approved teaching request for this mode)
studentIds    [String]  (PG UUIDs — students enrolled in this batch's mode)
schedule      String   location  String
mode          "classroom" | "live"  (default "classroom")
seats         Number (default 0)
status        "upcoming" | "ongoing" | "completed"  (default "upcoming")
createdBy*    String  (admin PG UUID)
timestamps
```

#### Attendance
```
batchId        ObjectId → Batch        (set for CLASSROOM sessions)
onlineClassId  ObjectId → OnlineClass  (set for LIVE sessions)
courseId       ObjectId → Course
date*          String  "YYYY-MM-DD"
records        [{ studentId (PG UUID), status: "present"|"absent"|"leave" }]
markedBy*      String  (instructor/admin PG UUID)
timestamps
```
> Exactly one of `batchId` / `onlineClassId` is set per document.
> Partial-unique indexes: `{ batchId, date }` (one classroom session per batch per
> day) and `{ onlineClassId }` (one record per live class).

#### OnlineClass
```
title*        String
courseId*     ObjectId → Course
batchId       ObjectId → Batch   (null = course-wide; set = scoped to a live batch)
instructorId* String  (PG UUID — must have an approved "live" teaching request)
joinUrl*      String  (Zoom/Meet join link)
meetingId     String   passcode  String
startTime*    Date
durationMins  Number (default 60)
status        "scheduled" | "live" | "completed" | "cancelled"  (default "scheduled")
createdBy*    String  (admin PG UUID)
timestamps
```

#### SiteConfig
```
milestones  [{ value, label, icon, order }]
whyChooseUs [{ title, description, icon, order }]
faqs        [{ question, answer, order }]
timestamps
```
> Single document. `GET /site-config` returns built-in defaults until it's first saved.

> `*` = required.

---

## Environment Variables

Create a `.env` in `backend/`:

```ini
# Server
PORT=3000
NODE_ENV=development
CLIENT_URL=http://localhost:5173        # used for CORS in production

# JWT
ACCESS_TOKEN_SECRET=your_access_secret
REFRESH_TOKEN_SECRET=your_refresh_secret

# PostgreSQL (users) — see src/config/db.js
DATABASE_URL=postgres://user:pass@host:5432/dbname
# (or PGHOST / PGUSER / PGPASSWORD / PGDATABASE / PGPORT)

# MongoDB (courses, enrollments, progress, enquiries)
MONGODB_URI=mongodb://localhost:27017/fillip

# Cloudinary (media)
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...

# Razorpay (payments)
RAZORPAY_KEY_ID=...
RAZORPAY_KEY_SECRET=...

# Google Sign-In (POST /auth/google) — OAuth 2.0 Web client ID (token audience).
# Must match the client's VITE_GOOGLE_CLIENT_ID.
GOOGLE_CLIENT_ID=...

# OpenAI (POST /chat) — without it, the chat assistant returns a canned reply.
OPENAI_API_KEY=...

# Redis cache (OPTIONAL) — caches public reads (courses/blogs/testimonials/site-config).
# Unset = caching disabled (app runs normally). In prod, point at VPS-local Redis.
REDIS_URL=redis://127.0.0.1:6379

# Client URL (referral links, affiliate emails, CORS in production)
CLIENT_URL=http://localhost:5173

# Email (Nodemailer)
SMTP_USER=you@gmail.com
SMTP_PASS=app_password
ADMIN_EMAIL=admin@fillip.com
ADMIN_PHONE=+91XXXXXXXXXX

# WhatsApp routing (contact info)
WHATSAPP_GUEST=+91XXXXXXXXXX
WHATSAPP_INSTRUCTOR=+91XXXXXXXXXX
WHATSAPP_ENROLLED=+91XXXXXXXXXX
```

> Exact PostgreSQL and Cloudinary/Mongo variable names depend on `src/config/db.js`,
> `src/config/mongodb.js`, and `src/config/cloudinary.js` — check those files and
> match your `.env` accordingly.

---

*Generated from the route, controller, and model source under `backend/src/`. Keep
this file in sync when endpoints change.*
