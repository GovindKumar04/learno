import pool from "../config/db.js";

async function createTables() {
    try {

        // Enable UUID extension
        await pool.query(`
            CREATE EXTENSION IF NOT EXISTS "pgcrypto";
        `);

        // Create ENUM
        await pool.query(`
            CREATE TYPE user_role AS ENUM (
                'student',
                'instructor',
                'admin'
            );
        `);

        // Create users table
        await pool.query(`
            CREATE TABLE users (

                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

                full_name VARCHAR(100) NOT NULL,

                email VARCHAR(255) UNIQUE NOT NULL,

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