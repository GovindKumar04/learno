# Fillip Skill Academy — Backend API Reference

**Base URL:** `http://localhost:3000`  
**Auth:** Cookie-based JWT (`accessToken` + `refreshToken`). All protected routes require the `accessToken` cookie or `Authorization: Bearer <token>` header.

---

## Table of Contents

1. [Auth](#1-auth)
2. [Courses](#2-courses)
3. [Modules](#3-modules)
4. [Materials](#4-materials)
5. [Reviews & Testimonials](#5-reviews--testimonials)
6. [Enquiries (Admin Portal)](#6-enquiries-admin-portal)
7. [Contact (Public)](#7-contact-public)
8. [Progress](#8-progress)
9. [Enrollments](#9-enrollments)
10. [Error Format](#10-error-format)

---

## 1. Auth

| Method | Endpoint | Auth | Role |
|--------|----------|------|------|
| POST | `/auth/register` | ❌ | — |
| POST | `/auth/login` | ❌ | — |
| POST | `/auth/logout` | ❌ | — |
| POST | `/auth/refresh` | ❌ | — |
| GET | `/auth/me` | ✅ | any |

---

### POST `/auth/register`

Registers a new student or instructor. Admins cannot self-register.

**Request Body**
```json
{
  "full_name": "Govind Kumar",
  "email": "govind@example.com",
  "password": "Secret@123",
  "role": "student",
  "phone": "9876543210",
  "location": "Patna, Bihar"
}
```

| Field | Type | Rules |
|-------|------|-------|
| `full_name` | string | 3–100 chars |
| `email` | string | valid email |
| `password` | string | min 6 chars |
| `role` | string | `"student"` or `"instructor"` |
| `phone` | string | Indian mobile — regex `^[6-9]\d{9}$` |
| `location` | string | 2–255 chars |

**Success `201`**
```json
{
  "statusCode": 201,
  "data": {
    "id": "uuid",
    "full_name": "Govind Kumar",
    "email": "govind@example.com",
    "role": "student",
    "avatar": null,
    "phone": "9876543210",
    "location": "Patna, Bihar",
    "created_at": "2025-01-01T00:00:00Z"
  },
  "message": "User registered successfully",
  "success": true
}
```

**Errors**
- `400` — Validation failed / all fields required
- `401` — Attempt to register as admin
- `409` — Email already exists

---

### POST `/auth/login`

**Request Body**
```json
{
  "email": "govind@example.com",
  "password": "Secret@123"
}
```

**Success `200`** — Sets `accessToken` and `refreshToken` cookies.
```json
{
  "statusCode": 200,
  "data": {
    "user": {
      "id": "uuid",
      "full_name": "Govind Kumar",
      "email": "govind@example.com",
      "role": "student",
      "avatar": null,
      "phone": "9876543210",
      "location": "Patna, Bihar"
    },
    "accessToken": "<jwt>"
  },
  "message": "Login successful",
  "success": true
}
```

**Errors**
- `400` — Validation failed
- `401` — Invalid credentials
- `404` — User not found

---

### POST `/auth/logout`

Clears `accessToken` and `refreshToken` cookies.

**Success `200`**
```json
{ "statusCode": 200, "data": {}, "message": "Logout successful", "success": true }
```

---

### POST `/auth/refresh`

Issues a new `accessToken` using the `refreshToken` cookie.

**Success `200`** — Sets new `accessToken` cookie.
```json
{
  "statusCode": 200,
  "data": { "accessToken": "<new_jwt>" },
  "message": "Token refreshed",
  "success": true
}
```

**Errors**
- `401` — No/invalid/expired refresh token, or token mismatch

---

### GET `/auth/me`

Returns the currently authenticated user's profile from PostgreSQL.

**Success `200`**
```json
{
  "statusCode": 200,
  "data": {
    "id": "uuid",
    "full_name": "Govind Kumar",
    "email": "govind@example.com",
    "role": "student",
    "phone": "9876543210",
    "avatar": null,
    "is_verified": false,
    "is_active": true,
    "created_at": "2025-01-01T00:00:00Z"
  },
  "message": "Current user fetched successfully",
  "success": true
}
```

**Errors**
- `401` — Not authenticated
- `404` — User not found

---

## 2. Courses

All course routes require authentication (`verifyJWT`). Students only see **published** courses; admins see all.

| Method | Endpoint | Auth | Role |
|--------|----------|------|------|
| GET | `/courses` | ✅ | any |
| POST | `/courses` | ✅ | admin |
| GET | `/courses/:courseId` | ✅ | any |
| PATCH | `/courses/:courseId` | ✅ | admin |
| DELETE | `/courses/:courseId` | ✅ | admin |

---

### GET `/courses`

Returns a paginated list of courses. Students only receive published courses.

**Query Params**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 10 | Results per page |
| `category` | string | — | Filter by category |
| `level` | string | — | `beginner` / `intermediate` / `advanced` |

**Success `200`**
```json
{
  "statusCode": 200,
  "data": {
    "courses": [
      {
        "_id": "mongo_id",
        "title": "React Fundamentals",
        "description": "...",
        "thumbnail": "https://res.cloudinary.com/...",
        "category": "Web Development",
        "level": "beginner",
        "price": 999,
        "isPublished": true,
        "averageRating": 4.5,
        "totalReviews": 12,
        "totalStudentsEnrolled": 45,
        "createdAt": "2025-01-01T00:00:00Z"
      }
    ],
    "total": 25,
    "page": 1,
    "limit": 10
  },
  "message": "Success",
  "success": true
}
```

---

### POST `/courses`

Creates a new course. Accepts `multipart/form-data` for an optional thumbnail.

**Request** — `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | ✅ | Course title |
| `description` | string | ✅ | Course description |
| `category` | string | ✅ | e.g. `"Web Development"` |
| `level` | string | ❌ | `beginner` / `intermediate` / `advanced` |
| `price` | number | ❌ | Default `0` |
| `thumbnail` | file | ❌ | jpeg / png / webp, uploaded to Cloudinary |

**Success `201`**
```json
{
  "statusCode": 201,
  "data": {
    "_id": "mongo_id",
    "title": "React Fundamentals",
    "isPublished": false,
    "modules": [],
    "reviews": [],
    "averageRating": 0,
    "totalReviews": 0
  },
  "message": "Course created successfully",
  "success": true
}
```

**Errors**
- `400` — title, description, or category missing

---

### GET `/courses/:courseId`

Returns a single course with all modules and materials fully populated.

**Success `200`**
```json
{
  "statusCode": 200,
  "data": {
    "_id": "mongo_id",
    "title": "React Fundamentals",
    "description": "...",
    "thumbnail": "https://res.cloudinary.com/...",
    "benefits": ["Build real projects", "Understand hooks"],
    "prerequisites": ["Basic HTML/CSS"],
    "targetAudience": ["Beginners", "Frontend developers"],
    "language": "English",
    "modules": [
      {
        "_id": "mod_id",
        "title": "Getting Started",
        "order": 0,
        "materials": [
          {
            "_id": "mat_id",
            "title": "Intro Video",
            "type": "video",
            "url": "https://res.cloudinary.com/...",
            "duration": 360,
            "size": 104857600
          }
        ]
      }
    ],
    "reviews": [],
    "averageRating": 0,
    "totalReviews": 0
  },
  "message": "Success",
  "success": true
}
```

**Errors**
- `403` — Course is not published (non-admin users)
- `404` — Course not found

---

### PATCH `/courses/:courseId`

Updates course details. Accepts `multipart/form-data` to replace the thumbnail.

**Request** — `multipart/form-data` (all fields optional)

| Field | Description |
|-------|-------------|
| `title` | New title |
| `description` | New description |
| `category` | New category |
| `level` | New level |
| `price` | New price |
| `isPublished` | `true` / `false` to publish or unpublish |
| `thumbnail` | New image — old one deleted from Cloudinary |

**Success `200`** — Returns updated course object.

---

### DELETE `/courses/:courseId`

Permanently deletes the course, all its modules, all materials, and all associated Cloudinary files.

**Success `200`**
```json
{ "statusCode": 200, "data": null, "message": "Course deleted successfully", "success": true }
```

---

## 3. Modules

Nested under `/courses/:courseId/modules`. All require authentication.

| Method | Endpoint | Auth | Role |
|--------|----------|------|------|
| POST | `/courses/:courseId/modules` | ✅ | admin |
| GET | `/courses/:courseId/modules` | ✅ | any |
| PATCH | `/courses/:courseId/modules/:moduleId` | ✅ | admin |
| DELETE | `/courses/:courseId/modules/:moduleId` | ✅ | admin |

---

### POST `/courses/:courseId/modules`

**Request Body**
```json
{
  "title": "Getting Started",
  "description": "Introduction to the course",
  "order": 0
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `title` | ✅ | Module title |
| `description` | ❌ | Optional description |
| `order` | ❌ | Display order (defaults to current module count) |

**Success `201`** — Returns the created module object. Also appends the module ID to the course's `modules` array.

**Errors**
- `400` — Title missing
- `404` — Course not found

---

### GET `/courses/:courseId/modules`

Returns all modules for a course with materials populated, sorted by `order` ascending.

**Success `200`** — Array of module objects (same shape as populated modules in `GET /courses/:courseId`).

---

### PATCH `/courses/:courseId/modules/:moduleId`

Updates any field on the module. Uses MongoDB `$set` so only provided fields are changed.

**Request Body**
```json
{ "title": "Updated Title", "order": 2 }
```

**Success `200`** — Returns the updated module object.

**Errors**
- `404` — Module not found in this course

---

### DELETE `/courses/:courseId/modules/:moduleId`

Deletes the module, all its materials, all associated Cloudinary files, and removes the module reference from the course.

**Success `200`**
```json
{ "statusCode": 200, "data": null, "message": "Module deleted successfully", "success": true }
```

---

## 4. Materials

Nested under `/courses/:courseId/modules/:moduleId/materials`. Admin only.

| Method | Endpoint | Auth | Role |
|--------|----------|------|------|
| POST | `/courses/:courseId/modules/:moduleId/materials` | ✅ | admin |
| DELETE | `/courses/:courseId/modules/:moduleId/materials/:materialId` | ✅ | admin |

---

### POST `.../materials`

Uploads up to **10 files** in one request. Files are stored on Cloudinary; temp files are deleted after upload.

**Request** — `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `files` | file[] | ✅ | Max 10 files, max 500 MB each |
| `titles` | string | ❌ | JSON array or comma-separated titles, e.g. `["Intro","Notes"]` |

**Supported MIME types**

| Type | Detected as |
|------|-------------|
| `video/mp4`, `video/mkv`, `video/webm` | `video` |
| `application/pdf` | `pdf` |
| `image/jpeg`, `image/png`, `image/webp` | `image` |

**Success `201`**
```json
{
  "statusCode": 201,
  "data": [
    {
      "_id": "mat_id",
      "title": "Intro Video",
      "type": "video",
      "url": "https://res.cloudinary.com/...",
      "publicId": "courses/courseId/modules/moduleId/intro",
      "duration": 420,
      "size": 52428800,
      "order": 0,
      "module": "mod_id"
    }
  ],
  "message": "2 material(s) uploaded successfully",
  "success": true
}
```

**Errors**
- `400` — No files uploaded / unsupported file type
- `404` — Module not found in this course

---

### DELETE `.../materials/:materialId`

Deletes the material file from Cloudinary, removes it from the module's `materials` array, and deletes the MongoDB document.

**Success `200`**
```json
{ "statusCode": 200, "data": null, "message": "Material deleted successfully", "success": true }
```

---

## 5. Reviews & Testimonials

Embedded reviews on courses. Stored inside the `Course` document (one review per enrolled student per course). All routes require authentication.

| Method | Endpoint | Auth | Role |
|--------|----------|------|------|
| GET | `/courses/:courseId/reviews` | ✅ | any |
| GET | `/courses/:courseId/reviews/testimonials` | ✅ | any |
| POST | `/courses/:courseId/reviews` | ✅ | student (enrolled) |
| DELETE | `/courses/:courseId/reviews` | ✅ | student (own) / admin (any) |
| PATCH | `/courses/:courseId/reviews/featured` | ✅ | admin |

---

### GET `/courses/:courseId/reviews`

Paginated reviews with user details joined from PostgreSQL.

**Query Params**

| Param | Default | Description |
|-------|---------|-------------|
| `page` | 1 | Page number |
| `limit` | 10 | Results per page |

**Success `200`**
```json
{
  "statusCode": 200,
  "data": {
    "reviews": [
      {
        "userId": "pg_uuid",
        "rating": 5,
        "comment": "Excellent course!",
        "isFeatured": true,
        "createdAt": "2025-01-01T00:00:00Z",
        "user": { "id": "pg_uuid", "full_name": "Govind Kumar", "avatar": null }
      }
    ],
    "total": 12,
    "averageRating": 4.5,
    "page": 1,
    "limit": 10
  },
  "message": "Success",
  "success": true
}
```

---

### GET `/courses/:courseId/reviews/testimonials`

Returns only reviews where `isFeatured: true`. Used on the public course page.

**Success `200`** — Array of featured review objects with `user` field attached (same shape as above).

---

### POST `/courses/:courseId/reviews`

Enrolled student adds or updates their review. Posting again updates the existing review. `averageRating` and `totalReviews` on the course are recalculated automatically.

**Request Body**
```json
{
  "rating": 5,
  "comment": "Really well structured course!"
}
```

| Field | Required | Rules |
|-------|----------|-------|
| `rating` | ✅ | Integer 1–5 |
| `comment` | ❌ | Optional text |

**Success `200`**
```json
{
  "statusCode": 200,
  "data": { "averageRating": 4.5, "totalReviews": 13 },
  "message": "Review added",
  "success": true
}
```

**Errors**
- `400` — Invalid rating
- `403` — Student not enrolled in this course

---

### DELETE `/courses/:courseId/reviews`

Student deletes their own review. Admin can delete any review by passing `?userId=<uuid>`.

**Query Params (admin only)**

| Param | Description |
|-------|-------------|
| `userId` | UUID of the user whose review to delete |

**Success `200`**
```json
{ "statusCode": 200, "data": null, "message": "Review deleted", "success": true }
```

---

### PATCH `/courses/:courseId/reviews/featured`

Admin toggles whether a review is shown as a testimonial (`isFeatured`).

**Request Body**
```json
{
  "userId": "pg_uuid_of_reviewer",
  "isFeatured": true
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `userId` | ✅ | PG UUID of the reviewer |
| `isFeatured` | ❌ | `true` / `false`. Omit to toggle current value. |

**Success `200`** — Returns the updated review object with `message: "Review marked as testimonial"` or `"Review removed from testimonials"`.

---

## 6. Enquiries (Admin Portal)

All routes require admin authentication (`verifyJWT` + `requireRole("admin")`).

| Method | Endpoint | Auth | Role |
|--------|----------|------|------|
| GET | `/enquiries` | ✅ | admin |
| GET | `/enquiries/stats` | ✅ | admin |
| GET | `/enquiries/:id` | ✅ | admin |
| POST | `/enquiries/:id/reply` | ✅ | admin |
| PATCH | `/enquiries/:id/status` | ✅ | admin |

---

### GET `/enquiries`

Filtered, paginated list of all enquiries. Reply history is excluded for performance (use `GET /enquiries/:id` to see replies).

**Query Params**

| Param | Description |
|-------|-------------|
| `page` | Page number (default: `1`) |
| `limit` | Results per page (default: `10`) |
| `status` | `open` / `contacted` / `resolved` |
| `priority` | `low` / `medium` / `high` |
| `role` | `student` / `instructor` / `guest` |
| `category` | e.g. `general`, `courses`, `technical`, `billing`, `other` |
| `search` | Searches `name`, `email`, `subject`, `ticketId` (case-insensitive regex) |

**Success `200`**
```json
{
  "statusCode": 200,
  "data": {
    "enquiries": [
      {
        "_id": "mongo_id",
        "ticketId": "TKT-2025-0001",
        "name": "Govind Kumar",
        "email": "govind@example.com",
        "phone": "9876543210",
        "subject": "Course access issue",
        "message": "I cannot access module 3...",
        "role": "student",
        "status": "open",
        "priority": "medium",
        "category": "technical",
        "createdAt": "2025-01-01T00:00:00Z"
      }
    ],
    "total": 48,
    "page": 1,
    "limit": 10
  },
  "message": "Success",
  "success": true
}
```

---

### GET `/enquiries/stats`

Dashboard stats for the enquiry portal including counts by status, role, category, and average response time.

**Success `200`**
```json
{
  "statusCode": 200,
  "data": {
    "total": 48,
    "byStatus":   { "open": 12, "contacted": 20, "resolved": 16 },
    "byRole":     { "student": 30, "instructor": 8, "guest": 10 },
    "byCategory": { "general": 15, "technical": 20, "courses": 13 },
    "avgResponseTime": "3.2 hours"
  },
  "message": "Success",
  "success": true
}
```

`avgResponseTime` is calculated only from resolved enquiries that have a `respondedAt` timestamp. Returns `null` if no resolved enquiries exist.

---

### GET `/enquiries/:id`

Returns a single enquiry with full reply history and pre-built contact action links.

**Success `200`**
```json
{
  "statusCode": 200,
  "data": {
    "enquiry": {
      "_id": "mongo_id",
      "ticketId": "TKT-2025-0001",
      "name": "Govind Kumar",
      "email": "govind@example.com",
      "phone": "9876543210",
      "subject": "Course access issue",
      "message": "I cannot access module 3...",
      "role": "student",
      "status": "contacted",
      "priority": "medium",
      "category": "technical",
      "adminNote": "Checked DB — permissions were missing.",
      "respondedAt": "2025-01-01T11:00:00Z",
      "replies": [
        { "message": "I can't access module 3.", "sentBy": "user",  "sentAt": "2025-01-01T10:00:00Z" },
        { "message": "We've fixed it for you.", "sentBy": "admin", "sentAt": "2025-01-01T11:00:00Z" }
      ]
    },
    "contactLinks": {
      "callLink":      "tel:+919876543210",
      "whatsappLink":  "https://wa.me/919876543210?text=Hi+Govind...",
      "mailLink":      "mailto:govind@example.com?subject=Re:+%5BTKT-2025-0001%5D+Course+access+issue"
    }
  },
  "message": "Success",
  "success": true
}
```

---

### POST `/enquiries/:id/reply`

Admin replies to an enquiry. Saves the reply in the DB, sets status to `contacted`, sets `respondedAt` if not already set, and dispatches a reply email to the user.

**Request Body**
```json
{ "message": "Hi Govind, we have resolved your issue. Please try again." }
```

**Success `200`** — Returns the updated enquiry object (with new reply appended).

**Errors**
- `400` — Message is empty / enquiry is already `resolved`
- `404` — Enquiry not found

---

### PATCH `/enquiries/:id/status`

Updates status, priority, and/or admin note. All fields are optional.

**Request Body**
```json
{
  "status":    "resolved",
  "priority":  "high",
  "adminNote": "Escalated to dev team on 2025-01-05."
}
```

Setting `status` to `resolved` also sets `respondedAt` if not already set.

**Success `200`** — Returns the updated enquiry object.

---

## 7. Contact (Public)

These routes use `optionalAuth` — guests (no token) and logged-in users are both accepted. Admins are blocked.

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/contact/info` | optional | Get contact details + WhatsApp deep link |
| POST | `/contact/enquiry` | optional | Submit an enquiry (creates ticket + sends confirmation email) |

---

### GET `/contact/info`

Returns phone, email, and a WhatsApp link. The WhatsApp number and pre-filled message are personalised based on who is calling:

| Caller | WhatsApp number used |
|--------|----------------------|
| Guest / not logged in | `WHATSAPP_GUEST` |
| Student (not enrolled in any course) | `WHATSAPP_GUEST` |
| Student (enrolled in at least one course) | `WHATSAPP_ENROLLED` |
| Instructor | `WHATSAPP_INSTRUCTOR` |

**Errors**
- `403` — Admin users are blocked (they use the enquiry portal at `/enquiries`)

**Success `200`**
```json
{
  "statusCode": 200,
  "data": {
    "phone": {
      "number": "+916280381723",
      "label": "Call Admin Directly",
      "link": "tel:+916280381723"
    },
    "email": {
      "address": "admin@filliptechnologies.com",
      "label": "Email Us",
      "link": "mailto:admin@filliptechnologies.com"
    },
    "whatsapp": {
      "number": "+916280381723",
      "type": "Guest Support",
      "prefilledMessage": "Hi! I am interested in Fillip Skill Academy courses.",
      "link": "https://wa.me/916280381723?text=Hi%21+I+am+interested..."
    }
  },
  "message": "Success",
  "success": true
}
```

---

### POST `/contact/enquiry`

Submits a new enquiry. Creates a MongoDB document with a unique `ticketId`, and sends a confirmation email to the user.

**Request Body**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `subject` | string | ✅ | Enquiry subject line |
| `message` | string | ✅ | Full enquiry body |
| `name` | string | ❌* | Required for guests |
| `email` | string | ❌* | Required for guests |
| `phone` | string | ❌ | Optional contact number |
| `category` | string | ❌ | `general` / `courses` / `technical` / `billing` / `other` (default: `general`) |

*Logged-in users: `name`, `email`, `phone`, and `role` are auto-filled from the JWT.

**Success `200`**
```json
{
  "statusCode": 200,
  "data": { "ticketId": "TKT-2025-0042" },
  "message": "Enquiry submitted! Your ticket ID is TKT-2025-0042. We will get back to you within 24 hours.",
  "success": true
}
```

**Errors**
- `400` — Subject or message missing; guest missing name or email
- `403` — Admin users cannot submit enquiries

---

## 8. Progress

Tracks per-student, per-course material completion. All routes require authentication.

| Method | Endpoint | Auth | Role |
|--------|----------|------|------|
| POST | `/progress/mark-watched` | ✅ | student |
| GET | `/progress/my-progress/:courseId` | ✅ | student |
| GET | `/progress/course/:courseId` | ✅ | admin / instructor |
| GET | `/progress/student/:userId` | ✅ | admin |
| GET | `/progress/overview` | ✅ | admin |

---

### POST `/progress/mark-watched`

Marks a material as completed. `completionPercent` is recalculated. If called again on a fully-watched material, only `watchPercent` is updated (no duplicate entries).

**Request Body**
```json
{
  "courseId":    "mongo_course_id",
  "materialId":  "mongo_material_id",
  "watchPercent": 100
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `courseId` | ✅ | MongoDB ObjectId of the course |
| `materialId` | ✅ | MongoDB ObjectId of the material |
| `watchPercent` | ❌ | 0–100, default `100`. For videos: percentage watched. |

**Success `200`**
```json
{
  "statusCode": 200,
  "data": {
    "completionPercent": 45,
    "completedAt": null,
    "totalMaterials": 20,
    "completedMaterials": 9
  },
  "message": "Progress updated",
  "success": true
}
```

`completedAt` is set automatically when `completionPercent` reaches `100`.

**Errors**
- `400` — `courseId` or `materialId` missing
- `403` — Student not enrolled in this course

---

### GET `/progress/my-progress/:courseId`

Detailed progress breakdown by module for the authenticated student.

**Success `200`**
```json
{
  "statusCode": 200,
  "data": {
    "courseId": "mongo_id",
    "courseTitle": "React Fundamentals",
    "completionPercent": 45,
    "lastAccessedAt": "2025-01-05T10:00:00Z",
    "completedAt": null,
    "enrolledAt": "2025-01-01T00:00:00Z",
    "moduleBreakdown": [
      {
        "moduleId": "mod_id",
        "moduleTitle": "Getting Started",
        "totalMaterials": 4,
        "completedMaterials": 4,
        "modulePercent": 100,
        "materials": [
          {
            "materialId": "mat_id",
            "title": "Intro Video",
            "type": "video",
            "duration": 360,
            "isCompleted": true
          }
        ]
      }
    ]
  },
  "message": "Success",
  "success": true
}
```

**Errors**
- `403` — Student not enrolled
- `404` — Course not found

---

### GET `/progress/course/:courseId`

Admin or assigned instructor views all students' progress in a course.

**Query Params**

| Param | Default |
|-------|---------|
| `page` | 1 |
| `limit` | 20 |

**Success `200`**
```json
{
  "statusCode": 200,
  "data": {
    "courseTitle": "React Fundamentals",
    "totalMaterials": 20,
    "summary": {
      "totalEnrolled": 45,
      "avgCompletionPercent": 62,
      "fullyCompleted": 12,
      "inProgress": 33
    },
    "students": [
      {
        "userId": "pg_uuid",
        "user": { "id": "pg_uuid", "full_name": "Govind Kumar", "email": "g@g.com", "avatar": null },
        "completionPercent": 100,
        "completedMaterials": 20,
        "totalMaterials": 20,
        "lastAccessedAt": "2025-01-10T00:00:00Z",
        "completedAt": "2025-01-10T00:00:00Z"
      }
    ],
    "page": 1,
    "limit": 20,
    "total": 45
  },
  "message": "Success",
  "success": true
}
```

**Errors**
- `403` — Instructor trying to access another instructor's course
- `404` — Course not found

---

### GET `/progress/student/:userId`

Admin views all course progress for a specific student.

**Path Param:** `userId` — PostgreSQL user ID

**Success `200`**
```json
{
  "statusCode": 200,
  "data": [
    {
      "courseId": "mongo_id",
      "courseTitle": "React Fundamentals",
      "courseThumbnail": "https://res.cloudinary.com/...",
      "category": "Web Development",
      "completionPercent": 80,
      "lastAccessedAt": "2025-01-10T00:00:00Z",
      "completedAt": null,
      "enrolledAt": "2025-01-01T00:00:00Z"
    }
  ],
  "message": "Success",
  "success": true
}
```

---

### GET `/progress/overview`

Platform-wide aggregated progress stats per course, sorted by total students descending.

**Success `200`**
```json
{
  "statusCode": 200,
  "data": [
    {
      "courseId": "mongo_id",
      "courseTitle": "React Fundamentals",
      "totalStudents": 45,
      "avgCompletion": 62.3,
      "completed": 12,
      "neverStarted": 5,
      "completionRate": 26.7
    }
  ],
  "message": "Success",
  "success": true
}
```

---

## 9. Enrollments

Admin manages which students are enrolled in which courses. Students read their own enrollments.

| Method | Endpoint | Auth | Role |
|--------|----------|------|------|
| GET | `/enrollments/my-courses` | ✅ | student |
| POST | `/enrollments` | ✅ | admin |
| DELETE | `/enrollments/:enrollmentId` | ✅ | admin |
| GET | `/enrollments/course/:courseId/students` | ✅ | admin / instructor |
| GET | `/enrollments/student/:userId` | ✅ | admin |

---

### GET `/enrollments/my-courses`

Returns all active enrollments for the authenticated student with course details and progress summaries.

**Success `200`**
```json
{
  "statusCode": 200,
  "data": [
    {
      "enrollmentId": "mongo_id",
      "enrolledAt": "2025-01-01T00:00:00Z",
      "course": {
        "_id": "mongo_id",
        "title": "React Fundamentals",
        "description": "...",
        "thumbnail": "https://res.cloudinary.com/...",
        "category": "Web Development",
        "level": "beginner",
        "price": 999
      },
      "progress": {
        "completionPercent": 45,
        "lastAccessedAt": "2025-01-05T10:00:00Z"
      }
    }
  ],
  "message": "Success",
  "success": true
}
```

---

### POST `/enrollments`

Admin enrolls a student in a course. Also creates an empty Progress document for them. If the student was previously unenrolled, re-activates the enrollment instead of creating a new one.

**Request Body**
```json
{
  "userId":   "pg_user_id",
  "courseId": "mongo_course_id"
}
```

**Success `201`** — New enrollment created.  
**Success `200`** — Existing enrollment re-activated.

**Errors**
- `400` — Missing fields; user is not a student
- `404` — User or course not found
- `409` — Student already actively enrolled

---

### DELETE `/enrollments/:enrollmentId`

Soft-deletes an enrollment (`isActive: false`, records `unenrolledAt`). Progress history is preserved.

**Success `200`** — Returns the updated enrollment document.

**Errors**
- `400` — Student is already unenrolled
- `404` — Enrollment not found

---

### GET `/enrollments/course/:courseId/students`

Admin or instructor views all actively enrolled students in a course, with user info from PostgreSQL and progress from MongoDB.

**Query Params**

| Param | Default |
|-------|---------|
| `page` | 1 |
| `limit` | 20 |

**Success `200`**
```json
{
  "statusCode": 200,
  "data": {
    "students": [
      {
        "enrollmentId": "mongo_id",
        "enrolledAt": "2025-01-01T00:00:00Z",
        "user": {
          "id": "pg_uuid",
          "full_name": "Govind Kumar",
          "email": "govind@example.com",
          "phone": "9876543210",
          "avatar": null
        },
        "progress": {
          "completionPercent": 45,
          "lastAccessedAt": "2025-01-05T10:00:00Z",
          "completedAt": null
        }
      }
    ],
    "total": 45,
    "page": 1,
    "limit": 20
  },
  "message": "Success",
  "success": true
}
```

**Errors**
- `403` — Instructor trying to view another instructor's course students
- `404` — Course not found

---

### GET `/enrollments/student/:userId`

Admin views all active course enrollments for a specific student with course details and progress.

**Success `200`**
```json
{
  "statusCode": 200,
  "data": [
    {
      "enrollmentId": "mongo_id",
      "enrolledAt": "2025-01-01T00:00:00Z",
      "course": {
        "_id": "mongo_id",
        "title": "React Fundamentals",
        "thumbnail": "https://res.cloudinary.com/...",
        "category": "Web Development",
        "level": "beginner"
      },
      "progress": {
        "completionPercent": 45,
        "lastAccessedAt": "2025-01-05T10:00:00Z"
      }
    }
  ],
  "message": "Success",
  "success": true
}
```

---

## 10. Error Format

All errors follow a consistent shape:

```json
{
  "success": false,
  "statusCode": 400,
  "message": "Validation failed",
  "errors": [
    { "field": "email", "message": "Invalid email" }
  ]
}
```

In development (`NODE_ENV !== "production"`), a `stack` trace field is also included.

### Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200` | OK |
| `201` | Created |
| `400` | Bad Request — missing or invalid input |
| `401` | Unauthorized — not logged in or invalid token |
| `403` | Forbidden — insufficient role or ownership |
| `404` | Not Found |
| `409` | Conflict — duplicate resource |
| `500` | Internal Server Error |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: `3000`) |
| `NODE_ENV` | `development` or `production` |
| `DATABASE_URL` | PostgreSQL connection string (Neon recommended) |
| `MONGODB_URI` | MongoDB connection string |
| `ACCESS_TOKEN_SECRET` | JWT signing secret for access tokens |
| `ACCESS_TOKEN_EXPIRY` | Access token TTL, e.g. `1d` |
| `REFRESH_TOKEN_SECRET` | JWT signing secret for refresh tokens |
| `REFRESH_TOKEN_EXPIRY` | Refresh token TTL, e.g. `7d` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| `ADMIN_EMAIL` | Admin contact email (shown on contact page) |
| `ADMIN_PHONE` | Admin contact phone number |
| `WHATSAPP_GUEST` | WhatsApp number for guests / unenrolled users |
| `WHATSAPP_ENROLLED` | WhatsApp number for enrolled students |
| `WHATSAPP_INSTRUCTOR` | WhatsApp number for instructors |
| `SMTP_HOST` | SMTP server host, e.g. `smtp.gmail.com` |
| `SMTP_PORT` | SMTP port, e.g. `587` |
| `SMTP_USER` | SMTP username / sender email address |
| `SMTP_PASS` | SMTP password or app password |
| `CLIENT_URL` | Frontend origin URL (used for CORS in production) |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Express 5 |
| Authentication | JWT (jsonwebtoken) + HTTP-only cookies |
| Primary DB | PostgreSQL via `pg` (Neon serverless compatible) |
| Secondary DB | MongoDB via Mongoose |
| File uploads | Multer (disk temp) → Cloudinary |
| Email | Nodemailer with Gmail SMTP |
| Input validation | Zod |
| Password hashing | bcrypt |
