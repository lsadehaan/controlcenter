'use strict';

/**
 * Centralized configuration with environment variable support
 */

module.exports = {
  // Server
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // Git SSH Server
  GIT_SSH_PORT: parseInt(process.env.GIT_SSH_PORT || '2223', 10),

  // Agent defaults
  AGENT_DEFAULT_PORT: parseInt(process.env.AGENT_DEFAULT_PORT || '8088', 10),
  AGENT_PROXY_TIMEOUT: parseInt(process.env.AGENT_PROXY_TIMEOUT || '10000', 10), // 10 seconds

  // Authentication
  JWT_SECRET: process.env.JWT_SECRET || 'change-this-secret',
  JWT_EXPIRY: process.env.JWT_EXPIRY || '7d',
  COOKIE_MAX_AGE: parseInt(process.env.COOKIE_MAX_AGE || String(7 * 24 * 60 * 60 * 1000), 10), // 7 days in ms
  COOKIE_SECURE: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',

  // Rate limiting
  AUTH_RATE_LIMIT_WINDOW: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW || '900000', 10), // 15 minutes
  AUTH_RATE_LIMIT_MAX: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '5', 10),
  API_RATE_LIMIT_WINDOW: parseInt(process.env.API_RATE_LIMIT_WINDOW || '900000', 10), // 15 minutes
  API_RATE_LIMIT_MAX: parseInt(process.env.API_RATE_LIMIT_MAX || '100', 10),

  // Database
  DB_PATH: process.env.DB_PATH || './data/control-center.db',

  // Git repository
  GIT_REPO_PATH: process.env.GIT_REPO_PATH || './data/config-repo',

  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  LOG_REQUESTS: process.env.LOG_REQUESTS === 'true' || false
};
