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
const Database = require('./db/database');
const WebSocketServer = require('./websocket/server');
const GitServer = require('./git/server');
const GitHttpServer = require('./git/http-server');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
const db = new Database();

// Initialize Git server
const gitServer = new GitServer();
const gitHttpServer = new GitHttpServer(gitServer, console);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// View engine
app.set('views', path.join(__dirname, '..', 'views'));
app.set('view engine', 'ejs');

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket server
const wsServer = new WebSocketServer(server, db, console, gitServer);

// API routes
app.use('/api', apiRoutes(db, wsServer, gitServer));

// Git HTTP server routes
app.use('/git', gitHttpServer.getRouter());

// Web UI routes
app.get('/', (req, res) => {
  res.render('index', { title: 'Control Center Manager' });
});

app.get('/agents', async (req, res) => {
  try {
    const agents = await db.getAllAgents();
    res.render('agents', { 
      title: 'Agents',
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
    
    // Get recent logs for this agent
    const logs = await db.getLogs(req.params.id, 50, 0);
    
    res.render('agent-view', { 
      title: `Agent: ${agent.hostname || agent.id}`,
      agent: {
        ...agent,
        config: JSON.parse(agent.config || '{}'),
        metadata: JSON.parse(agent.metadata || '{}')
      },
      logs: logs.map(l => ({
        ...l,
        metadata: JSON.parse(l.metadata || '{}')
      }))
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
      workflows: workflows.map(w => ({
        ...w,
        config: JSON.parse(w.config || '{}')
      }))
    });
  } catch (err) {
    console.error('Error loading workflows:', err);
    res.render('workflows', { 
      title: 'Workflows',
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
    workflow: workflow
  });
});

app.get('/workflow-editor-simple', (req, res) => {
  res.render('workflow-editor-simple', { title: 'Workflow Editor (Simple)' });
});

app.get('/alerts', async (req, res) => {
  try {
    const alerts = await db.getAlerts(100, 0);
    res.render('alerts', { 
      title: 'Alerts',
      alerts: alerts.map(a => ({
        ...a,
        details: JSON.parse(a.details || '{}')
      }))
    });
  } catch (err) {
    console.error('Error loading alerts:', err);
    res.render('alerts', { 
      title: 'Alerts',
      alerts: []
    });
  }
});

app.get('/logs', async (req, res) => {
  try {
    const logs = await db.getLogs(null, 100, 0);
    res.render('logs', { 
      title: 'Logs',
      logs: logs.map(l => ({
        ...l,
        metadata: JSON.parse(l.metadata || '{}')
      }))
    });
  } catch (err) {
    console.error('Error loading logs:', err);
    res.render('logs', { 
      title: 'Logs',
      logs: []
    });
  }
});

app.get('/settings', (req, res) => {
  res.render('settings', { title: 'Settings' });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something went wrong!');
});

// Start server
server.on('error', (err) => {
  console.error('HTTP server error:', err);
  process.exit(1);
});
server.listen(PORT, () => {
  console.log(`Manager listening on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`API endpoint: http://localhost:${PORT}/api`);
});