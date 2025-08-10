/*
 * Example CORS and security middleware for an Express server.
 *
 * This snippet demonstrates how to configure CORS using an allowlist
 * specified via environment variables.  It also enables Helmet for
 * sensible security defaults.  Preflight responses are cached for a
 * configurable TTL (max‑age ≤ 600 seconds).  Credentials are disabled
 * by default to protect against cookie leakage.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

/**
 * Builds a CORS options object based on environment variables.
 */
function buildCorsOptions() {
  const enabled = process.env.CORS_ENABLED === 'true';
  if (!enabled) return false;

  const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    origin: function (origin, callback) {
      // Reject wildcard in production.  Only allow specified origins.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('CORS origin not allowed'), false);
    },
    methods: process.env.CORS_ALLOW_METHODS || 'GET,POST,PUT,PATCH,DELETE',
    allowedHeaders: process.env.CORS_ALLOW_HEADERS || 'Authorization,Content-Type',
    credentials: process.env.CORS_ALLOW_CREDENTIALS === 'true',
    preflightContinue: false,
    optionsSuccessStatus: 204,
    maxAge: 600, // Preflight cache TTL in seconds (≤ 600)
  };
}

function createServer() {
  const app = express();
  app.use(helmet());

  const corsOptions = buildCorsOptions();
  if (corsOptions) {
    app.use(cors(corsOptions));
  }

  // Reject non‑preflight invalid methods early.
  app.use((req, res, next) => {
    if (['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'].includes(req.method)) {
      return next();
    }
    res.status(405).send('Method Not Allowed');
  });

  // Your routes go here
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  return app;
}

module.exports = { createServer };