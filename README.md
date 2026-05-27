# Fillip Skill Academy Backend

## Overview

This repository contains the backend API for the Fillip Skill Academy platform. It is built with Node.js and Express and supports:
- user registration and login
- JWT-based authentication
- PostgreSQL user storage
- MongoDB connection support
- input validation with Zod
- cookie-based access/refresh token handling

## Features

- `POST /auth/register` — register a new user
- `POST /auth/login` — authenticate a user and issue JWT tokens
- `POST /auth/logout` — clear authentication cookies
- `GET /auth/me` — get current logged-in user profile
- password hashing with `bcrypt`
- PostgreSQL queries via `pg`
- validation middleware with `zod`
- centralized API error handling

## Course API Endpoints

| Method | Endpoint | Role | Description |
| --- | --- | --- | --- |
| POST | `/api/courses` | admin | Create course + optional thumbnail |
| GET | `/api/courses` | all | List courses (students: published only) |
| GET | `/api/courses/:id` | all | Get course with modules & materials |
| PATCH | `/api/courses/:id` | admin | Update course details/thumbnail |
| DELETE | `/api/courses/:id` | admin | Delete course + all its files |
| POST | `/api/courses/:id/modules` | admin | Add a module |
| GET | `/api/courses/:id/modules` | all | List modules |
| PATCH | `/api/courses/:id/modules/:mid` | admin | Update module |
| DELETE | `/api/courses/:id/modules/:mid` | admin | Delete module + its materials |
| POST | `/api/courses/:id/modules/:mid/materials` | admin | Upload files (multipart, field: `files`) |
| DELETE | `/api/courses/:id/modules/:mid/materials/:mati` | admin | Delete a material |

## Prerequisites

- Node.js 18+
- npm
- PostgreSQL database
- MongoDB instance

## Setup

1. Install dependencies:
   ```bash
   npm install