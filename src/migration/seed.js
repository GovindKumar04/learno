import "dotenv/config";
import pool from "../config/db.js";

async function createTables() {
    try {

        // Enable UUID extension (gen_random_uuid as a fallback id generator)
        await pool.query(`
            CREATE EXTENSION IF NOT EXISTS "pgcrypto";
        `);

        // Create ENUM (idempotent — Postgres has no CREATE TYPE IF NOT EXISTS)
        await pool.query(`
            DO $$ BEGIN
                CREATE TYPE user_role AS ENUM ('student', 'instructor', 'admin');
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;
        `);

        // Create users table — UUID primary key (app supplies a UUIDv7; the
        // gen_random_uuid() default is only a safety net).
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (

                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                full_name VARCHAR(100) NOT NULL,

                email VARCHAR(255) UNIQUE NOT NULL,

                roll_number VARCHAR(20) UNIQUE,

                password TEXT NOT NULL,

                role user_role DEFAULT 'student',

                location VARCHAR(255) NOT NULL,

                refresh_token TEXT,

                avatar TEXT,

                phone VARCHAR(20) NOT NULL,

                is_verified BOOLEAN DEFAULT false,

                is_active BOOLEAN DEFAULT true,

                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log("Tables created successfully");

        process.exit(0);

    } catch (error) {

        console.log("Table creation failed");

        console.log(error);

        process.exit(1);
    }
}

createTables();