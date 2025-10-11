'use strict';

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');

class WebSocketServer {
  constructor(server, db, logger, gitServer) {
    this.wss = new WebSocket.Server({ server, path: '/ws' });
    this.db = db;
    this.logger = logger || console;
    this.gitServer = gitServer;
    this.clients = new Map(); // agentId -> WebSocket
    
    this.setupHandlers();
    this.startHeartbeatMonitor();
  }

  setupHandlers() {
    this.wss.on('connection', (ws, req) => {
      const connectionId = uuidv4();
      ws.connectionId = connectionId;
      ws.isAlive = true;

      // Capture the client's IP address
      const clientIp = req.headers['x-forwarded-for']?.split(',')[0] ||
                       req.socket.remoteAddress ||
                       'unknown';
      ws.clientIp = clientIp.replace('::ffff:', ''); // Remove IPv6 prefix if present

      this.logger.log(`WebSocket connection established: ${connectionId} from ${ws.clientIp}`);

      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data);
          await this.handleMessage(ws, message);
        } catch (err) {
          this.logger.error('Failed to handle message:', err);
          ws.send(JSON.stringify({
            type: 'error',
            payload: { error: err.message }
          }));
        }
      });

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('close', () => {
        this.handleDisconnect(ws);
      });

      ws.on('error', (err) => {
        this.logger.error(`WebSocket error for ${ws.agentId}:`, err);
      });
    });
  }

  async handleMessage(ws, message) {
    const { type, agentId, payload } = message;
    
    this.logger.log(`Message from ${agentId}: ${type}`);

    switch (type) {
      case 'registration':
        await this.handleRegistration(ws, agentId, payload);
        break;
        
      case 'reconnection':
        await this.handleReconnection(ws, agentId, payload);
        break;
        
      case 'heartbeat':
        await this.handleHeartbeat(ws, agentId, payload);
        break;
        
      case 'status':
        await this.handleStatus(ws, agentId, payload);
        break;
        
      case 'alert':
        await this.handleAlert(ws, agentId, payload);
        break;
        
      case 'log':
        await this.handleLog(ws, agentId, payload);
        break;
        
      default:
        this.logger.warn(`Unknown message type: ${type}`);
    }
  }

  async handleRegistration(ws, agentId, payload) {
    const { publicKey, token, hostname, platform } = payload;

    // Validate token and get metadata
    const tokenRecord = await this.db.validateToken(token);
    if (!tokenRecord) {
      ws.send(JSON.stringify({
        type: 'registration',
        payload: { success: false, error: 'Invalid or expired token' }
      }));
      ws.close();
      return;
    }

    // Parse token metadata to get API address if specified
    const tokenMetadata = tokenRecord.metadata ? JSON.parse(tokenRecord.metadata) : {};
    const apiAddress = tokenMetadata.apiAddress || null;

    // Register agent with connection IP and optional API address
    await this.db.registerAgent({
      id: agentId,
      hostname,
      platform,
      publicKey,
      metadata: {
        connectionIp: ws.clientIp,
        apiAddress: apiAddress  // Explicit API address from token, or null to use auto-detected connectionIp
      }
    });

    // Mark token as used
    await this.db.useToken(token, agentId);

    // Initialize agent config in Git repository
    if (this.gitServer) {
      try {
        // Check if config already exists (agent re-registering)
        const existingConfig = await this.gitServer.getAgentConfig(agentId);

        if (existingConfig) {
          // Preserve existing config, just update metadata
          existingConfig.hostname = hostname;
          existingConfig.platform = platform;
          await this.gitServer.saveAgentConfig(agentId, existingConfig);
          this.logger.log(`Preserved existing Git config for re-registered agent ${agentId}`);
        } else {
          // Create new initial config
          const initialConfig = {
            agentId,
            hostname,
            platform,
            fileWatcherSettings: {
              scanDir: '',
              scanSubDir: false
            },
            fileWatcherRules: [],
            workflows: []
          };
          await this.gitServer.saveAgentConfig(agentId, initialConfig);
          this.logger.log(`Initialized Git config for new agent ${agentId}`);
        }
      } catch (err) {
        this.logger.error(`Failed to save agent config to Git: ${err.message}`);
      }
    }

    // Associate WebSocket with agent
    ws.agentId = agentId;
    this.clients.set(agentId, ws);

    // Send success response
    ws.send(JSON.stringify({
      type: 'registration',
      payload: { success: true, agentId }
    }));

    this.logger.log(`Agent registered: ${agentId} from ${hostname}`);
  }

  async handleReconnection(ws, agentId, payload) {
    const { publicKey, hostname, platform } = payload;
    
    // Check if agent exists in database
    const agent = await this.db.getAgent(agentId);
    if (!agent) {
      ws.send(JSON.stringify({
        type: 'reconnection',
        payload: { success: false, error: 'Agent not found - registration required' }
      }));
      ws.close();
      return;
    }
    
    // Verify public key matches
    if (agent.public_key !== publicKey) {
      ws.send(JSON.stringify({
        type: 'reconnection',
        payload: { success: false, error: 'Public key mismatch' }
      }));
      ws.close();
      return;
    }
    
    // Update agent status
    await this.db.updateAgentStatus(agentId, 'online', Date.now());

    // Update metadata if hostname, platform, or connection IP changed
    const metadata = JSON.parse(agent.metadata || '{}');
    if (metadata.hostname !== hostname || metadata.platform !== platform || metadata.connectionIp !== ws.clientIp) {
      metadata.hostname = hostname;
      metadata.platform = platform;
      metadata.connectionIp = ws.clientIp;
      await this.db.updateAgentMetadata(agentId, metadata);
    }

    // Ensure agent config exists in Git repository
    if (this.gitServer) {
      try {
        const gitConfig = await this.gitServer.getAgentConfig(agentId);
        if (!gitConfig) {
          // Create initial config if it doesn't exist
          const agentConfig = JSON.parse(agent.config || '{}');
          const initialConfig = {
            agentId,
            hostname: metadata.hostname || hostname,
            platform: metadata.platform || platform,
            fileWatcherSettings: agentConfig.fileWatcherSettings || {
              scanDir: '',
              scanSubDir: false
            },
            fileWatcherRules: agentConfig.fileWatcherRules || [],
            workflows: agentConfig.workflows || []
          };
          await this.gitServer.saveAgentConfig(agentId, initialConfig);
          this.logger.log(`Created missing Git config for agent ${agentId}`);
        }
      } catch (err) {
        this.logger.error(`Failed to ensure Git config for agent ${agentId}: ${err.message}`);
      }
    }
    
    // Associate WebSocket with agent
    ws.agentId = agentId;
    this.clients.set(agentId, ws);
    
    // Send success response
    ws.send(JSON.stringify({
      type: 'reconnection',
      payload: { success: true, agentId }
    }));
    
    this.logger.log(`Agent reconnected: ${agentId} from ${hostname}`);
  }

  async handleHeartbeat(ws, agentId, payload) {
    if (!ws.agentId) {
      ws.agentId = agentId;
      this.clients.set(agentId, ws);
    }
    
    ws.isAlive = true;
    await this.db.updateAgentStatus(agentId, 'online', Date.now());
    
    // Send acknowledgment
    ws.send(JSON.stringify({
      type: 'heartbeat_ack',
      payload: { timestamp: Date.now() }
    }));
  }

  async handleStatus(ws, agentId, payload) {
    this.logger.log(`Status update from ${agentId}:`, payload);
    
    // Update agent metadata if needed
    const agent = await this.db.getAgent(agentId);
    if (agent) {
      const metadata = JSON.parse(agent.metadata || '{}');
      metadata.lastStatus = payload;
      metadata.lastStatusTime = Date.now();
      
      await this.db.db.run(
        'UPDATE agents SET metadata = ? WHERE id = ?',
        [JSON.stringify(metadata), agentId]
      );
    }
  }

  async handleAlert(ws, agentId, payload) {
    const { level, message, details } = payload;
    await this.db.createAlert(agentId, level, message, details);
    
    this.logger.log(`Alert from ${agentId}: [${level}] ${message}`);

    // Send notifications to configured channels (webhook/Slack)
    try {
      const metadata = await this.db.get('SELECT metadata FROM agents WHERE id = ?', [agentId]);
      const meta = metadata && metadata.metadata ? JSON.parse(metadata.metadata) : {};

      // Webhook URL can be stored globally in meta.notificationWebhook or per-level in meta.notificationWebhook_<level>
      const webhookUrl = meta[`notificationWebhook_${level}`] || meta.notificationWebhook;
      if (webhookUrl) {
        await this.sendWebhook(webhookUrl, {
          type: 'alert',
          agentId,
          level,
          message,
          details,
          timestamp: Date.now()
        });
      }

      // Slack webhook support (simple payload)
      const slackWebhook = meta[`slackWebhook_${level}`] || meta.slackWebhook;
      if (slackWebhook) {
        const text = `[*Alert*] [${level.toUpperCase()}] Agent ${agentId}: ${message}`;
        const slackPayload = { text };
        await this.sendWebhook(slackWebhook, slackPayload);
      }
    } catch (err) {
      this.logger.error('Failed to send alert notifications:', err);
    }
  }

  async handleLog(ws, agentId, payload) {
    const { level, message, metadata } = payload;
    await this.db.createLog(agentId, level, message, metadata);
  }

  async handleDisconnect(ws) {
    if (ws.agentId) {
      this.logger.log(`Agent disconnected: ${ws.agentId}`);
      this.clients.delete(ws.agentId);
      await this.db.updateAgentStatus(ws.agentId, 'offline');
    }
  }

  startHeartbeatMonitor() {
    // Ping clients every 30 seconds
    setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          this.handleDisconnect(ws);
          return ws.terminate();
        }
        
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000);
    
    // Check for stale agents every minute
    setInterval(async () => {
      const agents = await this.db.getAllAgents();
      const now = Date.now();
      const staleThreshold = 60000; // 1 minute
      
      for (const agent of agents) {
        if (agent.status === 'online' && (now - agent.last_heartbeat) > staleThreshold) {
          await this.db.updateAgentStatus(agent.id, 'offline');
          this.logger.log(`Marked agent ${agent.id} as offline (stale heartbeat)`);
        }
      }
    }, 60000);
  }

  // Send command to specific agent
  sendToAgent(agentId, type, payload) {
    const ws = this.clients.get(agentId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
      return true;
    }
    return false;
  }

  // Broadcast to all connected agents
  broadcast(type, payload) {
    const message = JSON.stringify({ type, payload });
    this.wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }

  // Generic webhook sender
  async sendWebhook(url, body) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        this.logger.warn(`Webhook responded with status ${response.status}`);
      }
    } catch (err) {
      this.logger.error('Webhook send failed:', err);
    }
  }
}

module.exports = WebSocketServer;