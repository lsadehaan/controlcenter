/*
 * Control Center Manager
 * Copyright (C) 2025 Your Organization
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

'use strict';

// Process-level error instrumentation
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

const path = require('path');
const express = require('express');
const http = require('http');
const cookieParser = require('cookie-parser');
const csurf = require('csurf');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const Database = require('./db/database');
const WebSocketServer = require('./websocket/server');
const GitServer = require('./git/server');
const GitHttpServer = require('./git/http-server');
const GitSSHServer = require('./git/ssh-server');
const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const { authMiddleware } = require('./utils/auth');
const packageJson = require('../package.json');

const app = express();

// Initialize database
const db = new Database();

// Initialize Git server
const gitServer = new GitServer();
const gitHttpServer = new GitHttpServer(gitServer, console);
const gitSSHServer = new GitSSHServer(gitServer, db, console, config.GIT_SSH_PORT);

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'"],
      // Allow HTTP for internal deployments (disable HTTPS upgrade)
      // For production with SSL, remove this line or set to [] to re-enable
      "upgrade-insecure-requests": null
    }
  }
})); // Security headers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Request logging (optional, disabled by default)
if (config.LOG_REQUESTS) {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    });
    next();
  });
}

// Rate limiter for auth routes
const authLimiter = rateLimit({
  windowMs: config.AUTH_RATE_LIMIT_WINDOW,
  max: config.AUTH_RATE_LIMIT_MAX,
  message: 'Too many login attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiter for API routes
const apiLimiter = rateLimit({
  windowMs: config.API_RATE_LIMIT_WINDOW,
  max: config.API_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false
});

// CSRF protection for UI forms (cookie-based)
const csrfProtection = csurf({ cookie: true });

// View engine
app.set('views', path.join(__dirname, '..', 'views'));
app.set('view engine', 'ejs');

// Make version available to all views
app.locals.version = packageJson.version;

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket server
const wsServer = new WebSocketServer(server, db, console, gitServer);

// API routes
app.use('/auth', authLimiter, authRoutes(db, csrfProtection));
app.use('/api', apiLimiter, authMiddleware(db), apiRoutes(db, wsServer, gitServer));

// Health endpoints
app.get('/api/health', async (req, res) => {
  try {
    const agents = await db.getAllAgents();
    const totalAgents = agents.length;
    const onlineAgents = agents.filter(a => a.status === 'online').length;
    const workflows = await db.all('SELECT COUNT(1) as c FROM workflows');
    const alerts = await db.all('SELECT COUNT(1) as c FROM alerts WHERE acknowledged = 0');

    res.json({
      status: 'ok',
      uptimeMs: Math.round(process.uptime() * 1000),
      agents: { total: totalAgents, online: onlineAgents },
      workflows: workflows && workflows[0] ? workflows[0].c : 0,
      unacknowledgedAlerts: alerts && alerts[0] ? alerts[0].c : 0
    });
  } catch (err) {
    console.error('Health check failed:', err);
    res.status(500).json({ status: 'error' });
  }
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Health endpoints
app.get('/api/health', async (req, res) => {
  try {
    const agents = await db.getAllAgents();
    const totalAgents = agents.length;
    const onlineAgents = agents.filter(a => a.status === 'online').length;
    const workflows = await db.all('SELECT COUNT(1) as c FROM workflows');
    const alerts = await db.all('SELECT COUNT(1) as c FROM alerts WHERE acknowledged = 0');

    res.json({
      status: 'ok',
      uptimeMs: Math.round(process.uptime() * 1000),
      agents: { total: totalAgents, online: onlineAgents },
      workflows: workflows && workflows[0] ? workflows[0].c : 0,
      unacknowledgedAlerts: alerts && alerts[0] ? alerts[0].c : 0
    });
  } catch (err) {
    console.error('Health check failed:', err);
    res.status(500).json({ status: 'error' });
  }
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Git HTTP server routes
app.use('/git', gitHttpServer.getRouter());

// Auth guard for all UI routes
app.use(authMiddleware(db, { ui: true }));

// Web UI routes
app.get('/', (req, res) => {
  res.render('index', { title: 'Control Center Manager', user: req.user, activePage: 'dashboard' });
});

app.get('/agents', async (req, res) => {
  try {
    const agents = await db.getAllAgents();
    res.render('agents', {
      title: 'Agents',
      user: req.user,
      activePage: 'agents',
      agents: agents.map(a => ({
        ...a,
        config: JSON.parse(a.config || '{}'),
        metadata: JSON.parse(a.metadata || '{}')
      }))
    });
  } catch (err) {
    console.error('Error loading agents:', err);
    res.render('agents', {
      title: 'Agents',
      user: req.user,
      activePage: 'agents',
      agents: []
    });
  }
});

app.get('/agents/:id', async (req, res) => {
  try {
    const agent = await db.getAgent(req.params.id);
    if (!agent) {
      return res.status(404).send('Agent not found');
    }

    const agentConfig = JSON.parse(agent.config || '{}');

    res.render('agent-details', {
      title: `Agent: ${agent.hostname || agent.id}`,
      user: req.user,
      activePage: 'agents',
      agent: {
        ...agent,
        config: agentConfig,
        metadata: JSON.parse(agent.metadata || '{}')
      },
      fileWatcherRules: agentConfig.fileWatcherRules || []
    });
  } catch (err) {
    console.error('Error loading agent:', err);
    res.status(500).send('Error loading agent');
  }
});

app.get('/agents/:id/filewatcher', async (req, res) => {
  try {
    const agent = await db.getAgent(req.params.id);
    if (!agent) {
      return res.status(404).send('Agent not found');
    }

    const agentConfig = JSON.parse(agent.config || '{}');

    res.render('agent-filewatcher', {
      title: `File Watchers: ${agent.metadata?.hostname || agent.id}`,
      user: req.user,
      activePage: 'agents',
      agent: {
        ...agent,
        config: agentConfig,
        metadata: JSON.parse(agent.metadata || '{}'),
        fileWatcherSettings: agentConfig.fileWatcherSettings || {}
      },
      fileWatcherRules: agentConfig.fileWatcherRules || []
    });
  } catch (err) {
    console.error('Error loading agent file watchers:', err);
    res.status(500).send('Error loading file watchers');
  }
});

app.get('/agents/:id/configure', async (req, res) => {
  try {
    const agent = await db.getAgent(req.params.id);
    if (!agent) {
      return res.status(404).send('Agent not found');
    }

    const agentData = {
      ...agent,
      config: JSON.parse(agent.config || '{}'),
      metadata: JSON.parse(agent.metadata || '{}')
    };

    res.render('agent-configure', {
      title: `Configure: ${agentData.metadata.hostname || agentData.id}`,
      user: req.user,
      activePage: 'agents',
      agent: agentData
    });
  } catch (err) {
    console.error('Error loading agent:', err);
    res.status(500).send('Error loading agent');
  }
});

app.get('/workflows', async (req, res) => {
  try {
    const workflows = await db.all('SELECT * FROM workflows ORDER BY updated_at DESC');
    res.render('workflows', {
      title: 'Workflows',
      user: req.user,
      activePage: 'workflows',
      workflows: workflows.map(w => ({
        ...w,
        config: JSON.parse(w.config || '{}')
      }))
    });
  } catch (err) {
    console.error('Error loading workflows:', err);
    res.render('workflows', {
      title: 'Workflows',
      user: req.user,
      activePage: 'workflows',
      workflows: []
    });
  }
});

app.get('/workflow-editor', async (req, res) => {
  const workflowId = req.query.id;
  let workflow = null;

  if (workflowId) {
    try {
      workflow = await db.get('SELECT * FROM workflows WHERE id = ?', [workflowId]);
      if (workflow) {
        workflow.config = JSON.parse(workflow.config || '{}');
      }
    } catch (err) {
      console.error('Error loading workflow:', err);
    }
  }

  res.render('workflow-editor', {
    title: 'Workflow Editor',
    user: req.user,
    activePage: 'editor',
    workflow: workflow
  });
});

app.get('/workflow-editor-simple', (req, res) => {
  res.render('workflow-editor-simple', {
    title: 'Workflow Editor (Simple)',
    user: req.user,
    activePage: 'editor'
  });
});

app.get('/alerts', async (req, res) => {
  try {
    const alerts = await db.getAlerts(100, 0);
    res.render('alerts', {
      title: 'Alerts',
      user: req.user,
      activePage: 'alerts',
      alerts: alerts.map(a => ({
        ...a,
        details: JSON.parse(a.details || '{}')
      }))
    });
  } catch (err) {
    console.error('Error loading alerts:', err);
    res.render('alerts', {
      title: 'Alerts',
      user: req.user,
      activePage: 'alerts',
      alerts: []
    });
  }
});

app.get('/logs', async (req, res) => {
  try {
    const logs = await db.getLogs(null, 100, 0);
    res.render('logs', {
      title: 'Logs',
      user: req.user,
      activePage: 'logs',
      logs: logs.map(l => ({
        ...l,
        metadata: JSON.parse(l.metadata || '{}')
      }))
    });
  } catch (err) {
    console.error('Error loading logs:', err);
    res.render('logs', {
      title: 'Logs',
      user: req.user,
      activePage: 'logs',
      logs: []
    });
  }
});

app.get('/settings', (req, res) => {
  res.render('settings', {
    title: 'Settings',
    user: req.user,
    activePage: 'settings',
    version: packageJson.version
  });
});

// Centralized error handler
app.use((err, req, res, next) => {
  // Log the error
  console.error('Error:', err);
  console.error('Stack:', err.stack);

  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';

  // Check if this is an API request
  if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
    return res.status(status).json({
      error: message,
      ...(config.NODE_ENV === 'development' && { stack: err.stack })
    });
  }

  // For UI requests, render an error page
  res.status(status).render('error', {
    title: 'Error',
    error: {
      status,
      message,
      ...(config.NODE_ENV === 'development' && { stack: err.stack })
    },
    user: req.user || null,
    activePage: null
  });
});

// Start server
server.on('error', (err) => {
  console.error('HTTP server error:', err);
  process.exit(1);
});
server.listen(config.PORT, () => {
  console.log(`Manager listening on http://localhost:${config.PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${config.PORT}/ws`);
  console.log(`API endpoint: http://localhost:${config.PORT}/api`);

  // Start Git SSH server
  gitSSHServer.start().catch(err => {
    console.error('Failed to start Git SSH server:', err);
  });
});