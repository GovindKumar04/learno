const path = require("path");

// PM2 process config for the Fillip Skill Academy backend.
// Usage (from the backend/ folder):
//   pm2 start deploy/ecosystem.config.cjs
//   pm2 save && pm2 startup     # persist across reboots
//
// IMPORTANT: keep this a SINGLE fork-mode instance. The rate limiters and chat
// limiter use an in-memory store (see middlewares/rateLimit.middleware.js), which
// is per-process — running a PM2 cluster would give each worker its own counters.
// Move those to a shared store (e.g. Redis) before scaling to multiple instances.
module.exports = {
  apps: [
    {
      name: "fillip-api",
      cwd: path.resolve(__dirname, ".."),   // run from backend/ so .env + uploads resolve
      script: "src/server.js",
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production" },
      max_memory_restart: "500M",
      autorestart: true,
      time: true,
      error_file: "logs/err.log",
      out_file: "logs/out.log",
    },
  ],
};
