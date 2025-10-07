'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { importFromINI, exportToINI } = require('../utils/ini-converter');
const router = express.Router();

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

  // Update agent configuration
  router.put('/agents/:id/config', async (req, res) => {
    try {
      const agent = await db.getAgent(req.params.id);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      
      // Update config in database
      await db.db.run(
        'UPDATE agents SET config = ? WHERE id = ?',
        [JSON.stringify(req.body), req.params.id]
      );
      
      // Notify agent to reload config
      wsServer.sendToAgent(req.params.id, 'config', {
        configPath: 'agent.json'
      });
      
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Generate registration token
  router.post('/tokens', async (req, res) => {
    try {
      const token = uuidv4();
      const expiresIn = req.body.expiresIn || 3600000; // 1 hour default
      
      await db.createToken(token, expiresIn);
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
      
      // First, save the workflow to git repository
      if (gitServer) {
        await gitServer.saveWorkflow(workflow.id, workflowConfig);
      }
      
      for (const agentId of agentIds) {
        const agent = await db.getAgent(agentId);
        if (agent) {
          const config = JSON.parse(agent.config || '{}');
          config.workflows = config.workflows || [];
          
          // Add or update workflow
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

      const hostname = agent.hostname || 'localhost';
      const agentUrl = `http://${hostname}:8088`;

      // Forward query parameters
      const queryParams = new URLSearchParams(req.query).toString();
      const url = `${agentUrl}/api/logs?${queryParams}`;

      const fetch = require('node-fetch');
      const response = await fetch(url);

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

      const hostname = agent.hostname || 'localhost';
      const agentUrl = `http://${hostname}:8088`;

      // Forward query parameters
      const queryParams = new URLSearchParams(req.query).toString();
      const url = `${agentUrl}/api/logs/download?${queryParams}`;

      const fetch = require('node-fetch');
      const response = await fetch(url);

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

      const hostname = agent.hostname || 'localhost';
      const agentUrl = `http://${hostname}:8088`;

      const queryParams = new URLSearchParams(req.query).toString();
      const url = `${agentUrl}/api/workflows/executions?${queryParams}`;

      const fetch = require('node-fetch');
      const response = await fetch(url);
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

      const hostname = agent.hostname || 'localhost';
      const agentUrl = `http://${hostname}:8088`;

      const url = `${agentUrl}/api/metrics`;

      const fetch = require('node-fetch');
      const response = await fetch(url);
      const data = await response.json();

      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};