const path = require("path");




module.exports = {
  apps: [
    {
      name: "fillip-api",
      cwd: path.resolve(__dirname, ".."), 
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
