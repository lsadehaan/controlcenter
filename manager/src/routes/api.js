'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { importFromINI, exportToINI} = require('../utils/ini-converter');
const { validatePassword } = require('./auth');
const fetch = require('node-fetch');
const config = require('../config');
const router = express.Router();

/**
 * Fetch with timeout using AbortController
 * Prevents requests from hanging indefinitely when agents are unresponsive
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = config.AGENT_PROXY_TIMEOUT) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeout);
    return response;
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw err;
  }
}

module.exports = (db, wsServer, gitServer) => {
  // Get all agents
  router.get('/agents', async (req, res) => {
    try {
      const agents = await db.getAllAgents();
      res.json(agents.map(agent => ({
        ...agent,
        config: JSON.parse(agent.config || '{}'),
        metadata: JSON.parse(agent.metadata || '{}')
      })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get specific agent
  router.get('/agents/:id', async (req, res) => {
    try {
      const agent = await db.getAgent(req.params.id);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      res.json({
        ...agent,
        config: JSON.parse(agent.config || '{}'),
        metadata: JSON.parse(agent.metadata || '{}')
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Send command to agent
  router.post('/agents/:id/command', async (req, res) => {
    try {
      const { command, args } = req.body;
      const success = wsServer.sendToAgent(req.params.id, 'command', {
        command,
        args
      });
      
      if (success) {
        res.json({ success: true, message: 'Command sent' });
      } else {
        res.status(404).json({ error: 'Agent not connected' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // (Removed legacy config update handler in favor of Git-backed flow below)

  // Generate registration token
  router.post('/tokens', async (req, res) => {
    try {
      const token = uuidv4();
      const expiresIn = req.body.expiresIn || 3600000; // 1 hour default
      const apiAddress = req.body.apiAddress || null;

      await db.createToken(token, expiresIn, apiAddress ? { apiAddress } : null);
      res.json({
        token,
        expiresAt: new Date(Date.now() + expiresIn).toISOString()
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get alerts
  router.get('/alerts', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 100;
      const offset = parseInt(req.query.offset) || 0;
      
      const alerts = await db.getAlerts(limit, offset);
      res.json(alerts.map(alert => ({
        ...alert,
        details: JSON.parse(alert.details || '{}')
      })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Acknowledge alert
  router.put('/alerts/:id/acknowledge', async (req, res) => {
    try {
      await db.run(
        'UPDATE alerts SET acknowledged = 1, acknowledged_at = ? WHERE id = ?',
        [Date.now(), req.params.id]
      );
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get logs
  router.get('/logs', async (req, res) => {
    try {
      const agentId = req.query.agentId;
      const limit = parseInt(req.query.limit) || 100;
      const offset = parseInt(req.query.offset) || 0;
      
      const logs = await db.getLogs(agentId, limit, offset);
      res.json(logs.map(log => ({
        ...log,
        metadata: JSON.parse(log.metadata || '{}')
      })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Workflow endpoints
  router.get('/workflows', async (req, res) => {
    try {
      const workflows = await db.all('SELECT * FROM workflows ORDER BY updated_at DESC');
      res.json(workflows.map(wf => ({
        ...wf,
        config: JSON.parse(wf.config || '{}')
      })));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/workflows', async (req, res) => {
    try {
      const id = uuidv4();
      const { name, description, config } = req.body;
      
      await db.run(
        'INSERT INTO workflows (id, name, description, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, name, description, JSON.stringify(config), Date.now(), Date.now()]
      );
      
      res.json({ id, success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/workflows/:id', async (req, res) => {
    try {
      const { name, description, config } = req.body;
      
      await db.run(
        'UPDATE workflows SET name = ?, description = ?, config = ?, updated_at = ? WHERE id = ?',
        [name, description, JSON.stringify(config), Date.now(), req.params.id]
      );
      
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/workflows/:id', async (req, res) => {
    try {
      await db.run('DELETE FROM workflows WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get agents that have a specific workflow deployed
  router.get('/workflows/:id/agents', async (req, res) => {
    try {
      const workflowId = req.params.id;
      const allAgents = await db.getAllAgents();

      // Filter agents that have this workflow in their config
      const agentsWithWorkflow = allAgents.filter(agent => {
        try {
          const config = JSON.parse(agent.config || '{}');
          const workflows = config.workflows || [];
          return workflows.some(w => w.id === workflowId);
        } catch (err) {
          return false;
        }
      });

      // Return simplified agent data
      const agentData = agentsWithWorkflow.map(agent => ({
        id: agent.id,
        hostname: agent.hostname,
        status: agent.status,
        platform: agent.platform
      }));

      res.json(agentData);
    } catch (err) {
      console.error('Error fetching agents for workflow:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Deploy workflow to agents
  router.post('/workflows/:id/deploy', async (req, res) => {
    try {
      const { agentIds } = req.body;
      const workflow = await db.get('SELECT * FROM workflows WHERE id = ?', [req.params.id]);

      if (!workflow) {
        return res.status(404).json({ error: 'Workflow not found' });
      }

      let deployed = 0;
      const workflowConfig = JSON.parse(workflow.config);

      // IMPORTANT: Ensure the workflow config's ID matches the database ID
      // This prevents duplicate deployments when the config has a different ID
      workflowConfig.id = workflow.id;

      // First, save the workflow to git repository
      if (gitServer) {
        await gitServer.saveWorkflow(workflow.id, workflowConfig);
      }

      for (const agentId of agentIds) {
        const agent = await db.getAgent(agentId);
        if (agent) {
          const config = JSON.parse(agent.config || '{}');
          config.workflows = config.workflows || [];

          // Add or update workflow - now that IDs match, this will properly update
          const existingIndex = config.workflows.findIndex(w => w.id === workflow.id);

          if (existingIndex >= 0) {
            config.workflows[existingIndex] = workflowConfig;
          } else {
            config.workflows.push(workflowConfig);
          }

          // Update agent config in database
          await db.run('UPDATE agents SET config = ? WHERE id = ?', [JSON.stringify(config), agentId]);

          // Save to Git repository - this is the source of truth
          if (gitServer) {
            await gitServer.saveAgentConfig(agentId, config);
          }

          // Send git-pull command to agent instead of the workflow
          if (wsServer.sendToAgent(agentId, 'command', {
            command: 'git-pull',
            args: {}
          })) {
            deployed++;
          }
        }
      }

      res.json({ success: true, deployed });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update agent configuration
  router.put('/agents/:id/config', async (req, res) => {
    try {
      const agent = await db.getAgent(req.params.id);

      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      // Merge the new config with existing config
      const existingConfig = JSON.parse(agent.config || '{}');
      const newConfig = { ...existingConfig, ...req.body };
      
      // Update agent config in database
      await db.run('UPDATE agents SET config = ? WHERE id = ?', [JSON.stringify(newConfig), req.params.id]);
      
      // Save to Git repository - this is the source of truth
      if (gitServer) {
        await gitServer.saveAgentConfig(req.params.id, newConfig);
      }
      
      // Send git-pull command to agent to update from repository
      if (wsServer.sendToAgent(req.params.id, 'command', { 
        command: 'git-pull',
        args: {}
      })) {
        res.json({ success: true, message: 'Configuration saved to git, agent notified to pull' });
      } else {
        res.json({ success: true, message: 'Configuration saved to git, agent offline' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Remove workflow from specific agent
  router.delete('/agents/:agentId/workflows/:workflowId', async (req, res) => {
    try {
      const agent = await db.getAgent(req.params.agentId);

      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      const config = JSON.parse(agent.config || '{}');
      config.workflows = config.workflows || [];

      const originalLength = config.workflows.length;
      config.workflows = config.workflows.filter(w => w.id !== req.params.workflowId);

      const removedFromDb = config.workflows.length < originalLength;

      // Always update database and git, even if workflow wasn't in database
      // This ensures database stays in sync with agent's actual state
      await db.run('UPDATE agents SET config = ? WHERE id = ?', [JSON.stringify(config), req.params.agentId]);

      // Update Git repository
      if (gitServer) {
        await gitServer.saveAgentConfig(req.params.agentId, config);
      }

      // Send git-pull command to agent to update from repository
      const agentOnline = wsServer.sendToAgent(req.params.agentId, 'command', {
        command: 'git-pull',
        args: {}
      });

      let message;
      if (removedFromDb) {
        message = agentOnline ? 'Workflow removed and agent notified' : 'Workflow removed, agent offline';
      } else {
        message = agentOnline ? 'Workflow synced (not in database, agent notified)' : 'Workflow synced (not in database, agent offline)';
      }

      res.json({ success: true, message: message, removedFromDb: removedFromDb });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // File Watcher endpoints
  router.put('/agents/:id/filewatcher', async (req, res) => {
    try {
      const agent = await db.getAgent(req.params.id);
      
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      
      const config = JSON.parse(agent.config || '{}');
      config.fileWatcherRules = req.body.rules || [];
      
      // Update agent config in database
      await db.run('UPDATE agents SET config = ? WHERE id = ?', [JSON.stringify(config), req.params.id]);
      
      // Save to Git repository
      if (gitServer) {
        await gitServer.saveAgentConfig(req.params.id, config);
      }
      
      // Send reload command to agent
      if (wsServer.sendToAgent(req.params.id, 'command', { 
        command: 'reload-filewatcher',
        args: {}
      })) {
        res.json({ success: true, message: 'File watcher rules updated and agent notified' });
      } else {
        res.json({ success: true, message: 'File watcher rules saved, agent offline' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Update agent API address
  router.put('/agents/:id/api-address', async (req, res) => {
    try {
      const agent = await db.getAgent(req.params.id);

      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }

      const metadata = JSON.parse(agent.metadata || '{}');

      // Update or clear the API address
      if (req.body.apiAddress === null || req.body.apiAddress === undefined) {
        delete metadata.apiAddress;
      } else {
        // Strip http:// or https:// prefix if present
        metadata.apiAddress = req.body.apiAddress.replace(/^https?:\/\//, '');
      }

      await db.updateAgentMetadata(req.params.id, metadata);

      res.json({
        success: true,
        message: 'API address updated',
        apiAddress: metadata.apiAddress || null
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Import INI file
  router.post('/agents/:id/filewatcher/import', async (req, res) => {
    try {
      const agent = await db.getAgent(req.params.id);
      
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      
      // Handle file upload (using multer or similar)
      // For now, we'll assume the INI content is sent as text
      const iniContent = req.body.content;
      
      // Parse INI and convert to rules
      const rules = importFromINI(iniContent);
      
      res.json({ success: true, rules });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  
  // Export to INI file
  router.get('/agents/:id/filewatcher/export', async (req, res) => {
    try {
      const agent = await db.getAgent(req.params.id);
      
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      
      const config = JSON.parse(agent.config || '{}');
      const rules = config.fileWatcherRules || [];
      
      // Convert rules to INI format
      const iniContent = exportToINI(rules);
      
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="filewatcher_${req.params.id}.ini"`);
      res.send(iniContent);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete agent
  router.delete('/agents/:id', async (req, res) => {
    try {
      const agent = await db.getAgent(req.params.id);
      
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      
      // Delete from database
      await db.run('DELETE FROM agents WHERE id = ?', [req.params.id]);
      
      // Notify via WebSocket if connected
      wsServer.sendToAgent(req.params.id, 'disconnect', {
        reason: 'Agent removed from manager'
      });
      
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete workflow
  router.delete('/workflows/:id', async (req, res) => {
    try {
      const workflow = await db.get('SELECT * FROM workflows WHERE id = ?', [req.params.id]);
      
      if (!workflow) {
        return res.status(404).json({ error: 'Workflow not found' });
      }
      
      // Remove from all agents that have this workflow
      const agents = await db.getAllAgents();
      let removed = 0;
      
      for (const agent of agents) {
        const config = JSON.parse(agent.config || '{}');
        if (config.workflows) {
          const originalLength = config.workflows.length;
          config.workflows = config.workflows.filter(w => w.id !== req.params.id);
          
          if (config.workflows.length < originalLength) {
            // Update agent config in database
            await db.run('UPDATE agents SET config = ? WHERE id = ?', [JSON.stringify(config), agent.id]);
            
            // Update Git repository
            if (gitServer) {
              await gitServer.saveAgentConfig(agent.id, config);
            }
            
            // Send git-pull command to agent to update from repository
            if (wsServer.sendToAgent(agent.id, 'command', { 
              command: 'git-pull',
              args: {}
            })) {
              removed++;
            }
          }
        }
      }
      
      // Delete from workflows table
      await db.run('DELETE FROM workflows WHERE id = ?', [req.params.id]);
      
      res.json({ success: true, removed });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Agent API proxy endpoints - forward requests to agent's local API

  // Helper function to get agent's HTTP API URL
  function getAgentUrl(agent) {
    const metadata = JSON.parse(agent.metadata || '{}');

    // Priority: explicit apiAddress > auto-detected connectionIp > localhost
    if (metadata.apiAddress) {
      // Admin specified address during registration
      return `http://${metadata.apiAddress}`;
    }

    // Fall back to auto-detected connection IP
    let agentHost = metadata.connectionIp || 'localhost';

    // Wrap IPv6 addresses in brackets for URL
    if (agentHost.includes(':') && !agentHost.includes('[')) {
      agentHost = `[${agentHost}]`;
    }

    return `http://${agentHost}:${config.AGENT_DEFAULT_PORT}`;
  }

  // Proxy agent logs
  router.get('/agents/:id/logs', async (req, res) => {
    try {
      const agent = await db.getAgent(req.params.id);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      if (agent.status !== 'online') {
        return res.status(503).json({ error: 'Agent is offline' });
      }

      const agentUrl = getAgentUrl(agent);

      // Forward query parameters
      const queryParams = new URLSearchParams(req.query).toString();
      const url = `${agentUrl}/api/logs?${queryParams}`;

      const response = await fetchWithTimeout(url);

      if (!response.ok) {
        return res.status(response.status).json({
          error: `Agent API error: ${response.statusText}`
        });
      }

      const data = await response.json();
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: `Failed to connect to agent: ${err.message}` });
    }
  });

  // Proxy agent logs download
  router.get('/agents/:id/logs/download', async (req, res) => {
    try {
      const agent = await db.getAgent(req.params.id);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      if (agent.status !== 'online') {
        return res.status(503).json({ error: 'Agent is offline' });
      }

      const agentUrl = getAgentUrl(agent);

      // Forward query parameters
      const queryParams = new URLSearchParams(req.query).toString();
      const url = `${agentUrl}/api/logs/download?${queryParams}`;

      const response = await fetchWithTimeout(url);

      // Forward headers and stream the response
      res.setHeader('Content-Type', response.headers.get('content-type'));
      res.setHeader('Content-Disposition', response.headers.get('content-disposition'));

      response.body.pipe(res);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Proxy agent workflow executions
  router.get('/agents/:id/workflows/executions', async (req, res) => {
    try {
      const agent = await db.getAgent(req.params.id);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      if (agent.status !== 'online') {
        return res.status(503).json({ error: 'Agent is offline' });
      }

      const agentUrl = getAgentUrl(agent);

      const queryParams = new URLSearchParams(req.query).toString();
      const url = `${agentUrl}/api/workflows/executions?${queryParams}`;

      const response = await fetchWithTimeout(url);
      const data = await response.json();

      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Proxy agent metrics
  router.get('/agents/:id/metrics', async (req, res) => {
    try {
      const agent = await db.getAgent(req.params.id);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      if (agent.status !== 'online') {
        return res.status(503).json({ error: 'Agent is offline' });
      }

      const agentUrl = getAgentUrl(agent);

      const url = `${agentUrl}/api/metrics`;

      const response = await fetchWithTimeout(url);
      const data = await response.json();

      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Proxy agent info (version, platform, hostname)
  router.get('/agents/:id/info', async (req, res) => {
    try {
      const agent = await db.getAgent(req.params.id);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      if (agent.status !== 'online') {
        return res.status(503).json({ error: 'Agent is offline' });
      }

      const agentUrl = getAgentUrl(agent);
      const url = `${agentUrl}/info`;

      const response = await fetchWithTimeout(url);
      const data = await response.json();

      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Proxy agent workflows state (deployed workflows)
  router.get('/agents/:id/workflows/state', async (req, res) => {
    try {
      const agent = await db.getAgent(req.params.id);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      if (agent.status !== 'online') {
        return res.status(503).json({ error: 'Agent is offline' });
      }

      const agentUrl = getAgentUrl(agent);
      const url = `${agentUrl}/api/workflows/state`;

      const response = await fetchWithTimeout(url);
      const data = await response.json();

      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // File Browser Proxy Endpoints

  // Browse files/directories
  router.get('/agents/:id/files/browse', async (req, res) => {
    try {
      const agent = await db.getAgent(req.params.id);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      if (agent.status !== 'online') {
        return res.status(503).json({ error: 'Agent is offline' });
      }

      const agentUrl = getAgentUrl(agent);
      const queryParams = new URLSearchParams(req.query).toString();
      const url = `${agentUrl}/api/files/browse?${queryParams}`;

      const response = await fetchWithTimeout(url);
      const data = await response.json();

      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Download file
  router.get('/agents/:id/files/download', async (req, res) => {
    try {
      const agent = await db.getAgent(req.params.id);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      if (agent.status !== 'online') {
        return res.status(503).json({ error: 'Agent is offline' });
      }

      const agentUrl = getAgentUrl(agent);
      const queryParams = new URLSearchParams(req.query).toString();
      const url = `${agentUrl}/api/files/download?${queryParams}`;

      const response = await fetchWithTimeout(url);

      if (!response.ok) {
        return res.status(response.status).send(await response.text());
      }

      // Forward headers and stream the response
      if (response.headers.get('content-type')) {
        res.setHeader('Content-Type', response.headers.get('content-type'));
      }
      if (response.headers.get('content-disposition')) {
        res.setHeader('Content-Disposition', response.headers.get('content-disposition'));
      }
      if (response.headers.get('content-length')) {
        res.setHeader('Content-Length', response.headers.get('content-length'));
      }

      response.body.pipe(res);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Upload file
  router.post('/agents/:id/files/upload', async (req, res) => {
    try {
      const agent = await db.getAgent(req.params.id);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      if (agent.status !== 'online') {
        return res.status(503).json({ error: 'Agent is offline' });
      }

      const agentUrl = getAgentUrl(agent);
      const url = `${agentUrl}/api/files/upload`;

      // Forward the multipart form data directly
      const FormData = require('form-data');
      const multer = require('multer');
      const upload = multer();

      // Use multer to parse multipart form data
      upload.single('file')(req, res, async (err) => {
        if (err) {
          return res.status(400).json({ error: 'File upload error: ' + err.message });
        }

        if (!req.file) {
          return res.status(400).json({ error: 'No file uploaded' });
        }

        // Create form data to forward to agent
        const form = new FormData();
        form.append('file', req.file.buffer, {
          filename: req.file.originalname,
          contentType: req.file.mimetype
        });
        form.append('path', req.body.path || '');

        try {
          const response = await fetchWithTimeout(url, {
            method: 'POST',
            body: form,
            headers: form.getHeaders()
          });

          const data = await response.json();
          res.status(response.status).json(data);
        } catch (fetchErr) {
          res.status(500).json({ error: 'Failed to forward upload to agent: ' + fetchErr.message });
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create directory
  router.post('/agents/:id/files/mkdir', async (req, res) => {
    try {
      const agent = await db.getAgent(req.params.id);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      if (agent.status !== 'online') {
        return res.status(503).json({ error: 'Agent is offline' });
      }

      const agentUrl = getAgentUrl(agent);
      const queryParams = new URLSearchParams(req.query).toString();
      const url = `${agentUrl}/api/files/mkdir?${queryParams}`;

      const response = await fetchWithTimeout(url, {
        method: 'POST'
      });

      const data = await response.json();
      res.status(response.status).json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete file or directory
  router.delete('/agents/:id/files/delete', async (req, res) => {
    try {
      const agent = await db.getAgent(req.params.id);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      if (agent.status !== 'online') {
        return res.status(503).json({ error: 'Agent is offline' });
      }

      const agentUrl = getAgentUrl(agent);
      const queryParams = new URLSearchParams(req.query).toString();
      const url = `${agentUrl}/api/files/delete?${queryParams}`;

      const response = await fetchWithTimeout(url, {
        method: 'DELETE'
      });

      const data = await response.json();
      res.status(response.status).json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // User Management Endpoints

  // Get all users
  router.get('/users', async (req, res) => {
    try {
      const users = await db.getAllUsers();
      res.json(users);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create new user
  router.post('/users', async (req, res) => {
    try {
      const { username, password, role } = req.body;

      // Validation
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
      }

      // Check if username already exists
      const existingUser = await db.findUserByUsername(username);
      if (existingUser) {
        return res.status(409).json({ error: 'Username already exists' });
      }

      // Password validation (reuses existing validation from auth.js)
      const passwordError = validatePassword(password);
      if (passwordError) {
        return res.status(400).json({ error: passwordError });
      }

      // Hash password
      const bcrypt = require('bcryptjs');
      const passwordHash = await bcrypt.hash(password, 10);

      // Create user
      const userId = uuidv4();
      await db.createUser(userId, username, passwordHash, role || 'admin');

      res.json({
        success: true,
        id: userId,
        username: username
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Reset user password
  router.put('/users/:id/password', async (req, res) => {
    try {
      const { password } = req.body;

      // Validation
      if (!password) {
        return res.status(400).json({ error: 'Password is required' });
      }

      // Check if user exists
      const user = await db.getUserById(req.params.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Password validation (reuses existing validation from auth.js)
      const passwordError = validatePassword(password);
      if (passwordError) {
        return res.status(400).json({ error: passwordError });
      }

      // Hash new password
      const bcrypt = require('bcryptjs');
      const passwordHash = await bcrypt.hash(password, 10);

      // Update password
      await db.updateUserPassword(req.params.id, passwordHash);

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete user
  router.delete('/users/:id', async (req, res) => {
    try {
      // Check if user exists
      const user = await db.getUserById(req.params.id);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Prevent deleting last user
      const userCount = await db.countUsers();
      if (userCount <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last user' });
      }

      // Delete user
      await db.deleteUser(req.params.id);

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};