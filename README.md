# Fillip Skill Academy — Backend API Documentation

REST API for the Fillip Skill Academy platform. Handles authentication & roll
numbers, course management (modules, materials, reviews), enrollments, learning
progress, payments, the affiliate program, scholarships, instructor teaching
requests, offline batches & attendance, the public site config, and the
contact/enquiry support portal.

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
   - [Site Config](#16-site-config----site-config)
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

### 1. Auth — `/auth`

| Method | Path             | Auth | Description                          |
|--------|------------------|------|--------------------------------------|
| POST   | `/auth/register` | 🔓   | Register a student or instructor     |
| POST   | `/auth/login`    | 🔓   | Log in, sets auth cookies            |
| POST   | `/auth/logout`   | 🔓   | Clear auth cookies                   |
| POST   | `/auth/refresh`  | 🔓   | Issue a new access token from cookie |
| GET    | `/auth/me`       | 🔑   | Get the current authenticated user   |
| PATCH  | `/auth/avatar`   | 🔑   | Upload/replace the caller's avatar   |
| POST   | `/auth/change-password` | 🔑 | Change the caller's password      |
| GET    | `/auth/users`    | 🛡️   | List users (filter `role`, `search` incl. roll, paginated) |

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
**Body** `{ "courseId": "<ObjectId>", "enrollmentType": "online" }` — `enrollmentType` is `online`|`offline` (picks `priceOnline`/`priceOffline`). Returns a pending order (reuses an existing pending one for the same course+type). Rejects if already enrolled (**409**) or price unset (**400**). Returns **503** if Razorpay keys are missing.
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

> Entire router behind `verifyJWT`. Instructors ask to teach a course; admins approve.

| Method | Path                       | Auth            | Description                                |
|--------|----------------------------|-----------------|--------------------------------------------|
| POST   | `/teaching-requests`       | 🎓              | Request to teach a course                  |
| GET    | `/teaching-requests/my`    | 🎓              | Caller's own requests                       |
| GET    | `/teaching-requests`       | 🛡️              | All requests (`?status=`, paginated)       |
| PATCH  | `/teaching-requests/:id`   | 🛡️              | Approve / reject                           |
| DELETE | `/teaching-requests/:id`   | 🛡️ / 🎓 (own)   | Cancel/remove a request                    |

#### POST `/teaching-requests` 🎓
**Body** `{ "courseId", "message"? }`. **409** if already pending/approved for the course; a previously **rejected** request is re-opened to `pending`. **201** (or **200** on re-submit) → request.

#### PATCH `/teaching-requests/:id` 🛡️
**Body** `{ "status": "approved" | "rejected" }`. Approval is the prerequisite for assigning the instructor to a [batch](#14-batches----batches). **200** → request.

---

### 14. Batches — `/batches`

> Entire router behind `verifyJWT`. Offline cohorts: an approved instructor + offline-enrolled students.

| Method | Path                                | Auth | Description                                          |
|--------|-------------------------------------|------|-----------------------------------------------------|
| GET    | `/batches/my`                       | 🎓   | Batches assigned to the caller (instructor)         |
| GET    | `/batches/course/:courseId/options` | 🛡️   | Assignable instructors + offline students for a course|
| GET    | `/batches`                          | 🛡️   | All batches (course + instructor + students)        |
| POST   | `/batches`                          | 🛡️   | Create a batch (emails instructor + students)       |
| PATCH  | `/batches/:id`                      | 🛡️   | Update a batch (re-notifies on assignment changes)  |
| DELETE | `/batches/:id`                      | 🛡️   | Delete a batch                                       |

#### GET `/batches/course/:courseId/options` 🛡️
**200** → `{ course: { id, title }, instructors: [...], students: [...] }` — instructors with an **approved** teaching request, and **offline, active** enrollees.

#### POST `/batches` 🛡️
**Body** `{ "name", "courseId", "instructorId", "studentIds"?: [], "schedule"?, "location"?, "seats"?, "status"? }`. Validates the instructor is approved and every student is offline-enrolled (**400** otherwise). Emails the schedule/location to all assigned. **201** → batch.

#### PATCH `/batches/:id` 🛡️
Same fields (course is fixed). Re-validates if instructor/roster changes; re-notifies when assignment, schedule, or location changes. **200** → batch.

---

### 15. Attendance — `/attendance`

> Entire router behind `verifyJWT` + `requireRole("instructor", "admin")`.
> One session = one batch on one calendar day; instructors are limited to their own batches.

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
price         Number (default 0)
thumbnail / thumbnailPublicId   String  (Cloudinary)
isPublished   Boolean (default false)
createdBy     String   (PG user id)
modules       [ObjectId → Module]
prerequisites / benefits / targetAudience   [String]
language      String (default "English")
totalDuration / totalStudentsEnrolled       Number
averageRating / totalReviews                Number
reviews       [{ userId, rating 1–5, comment, isFeatured, createdAt }]
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
enrollmentType "online" | "offline"  (default "online")
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
mode           "offline"  (default)
status         "pending" | "approved" | "rejected"  (default "pending")
reviewedBy     String (admin PG UUID)   reviewedAt  Date
timestamps
unique index: { instructorId, courseId }
```

#### Batch
```
name*         String
courseId*     ObjectId → Course
instructorId* String  (PG UUID — must have an approved teaching request)
studentIds    [String]  (PG UUIDs — offline-enrolled students)
schedule      String   location  String
mode          "offline"  (default)
seats         Number (default 0)
status        "upcoming" | "ongoing" | "completed"  (default "upcoming")
createdBy*    String  (admin PG UUID)
timestamps
```

#### Attendance
```
batchId*   ObjectId → Batch
courseId   ObjectId → Course
date*      String  "YYYY-MM-DD"
records    [{ studentId (PG UUID), status: "present"|"absent"|"leave" }]
markedBy*  String  (instructor/admin PG UUID)
timestamps
unique index: { batchId, date }   (one session per batch per day)
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
