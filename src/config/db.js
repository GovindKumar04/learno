import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,  // fail fast if Neon is unreachable
  idleTimeoutMillis: 30000,
  max: 10,
});


export default pool;
