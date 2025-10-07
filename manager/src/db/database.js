'use strict';

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

class Database {
  constructor(dbPath) {
    this.dbPath = dbPath || path.join(__dirname, '../../data/control-center.db');
    
    // Ensure data directory exists
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    this.db = new sqlite3.Database(this.dbPath);
    // Surface driver-level errors
    this.db.on('error', (e) => console.error('SQLite error:', e));
    this.init();
  }

  init() {
    this.db.serialize(() => {
      // Agents table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS agents (
          id TEXT PRIMARY KEY,
          hostname TEXT,
          platform TEXT,
          public_key TEXT UNIQUE,
          status TEXT DEFAULT 'offline',
          last_heartbeat INTEGER,
          registered_at INTEGER,
          config TEXT,
          metadata TEXT
        )
      `);

      // Registration tokens table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS registration_tokens (
          token TEXT PRIMARY KEY,
          created_at INTEGER,
          used_at INTEGER,
          used_by TEXT,
          expires_at INTEGER,
          metadata TEXT
        )
      `);

      // Workflows table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS workflows (
          id TEXT PRIMARY KEY,
          name TEXT,
          description TEXT,
          config TEXT,
          created_at INTEGER,
          updated_at INTEGER,
          created_by TEXT
        )
      `);

      // Alerts table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS alerts (
          id TEXT PRIMARY KEY,
          agent_id TEXT,
          level TEXT,
          message TEXT,
          details TEXT,
          created_at INTEGER,
          acknowledged BOOLEAN DEFAULT 0,
          acknowledged_at INTEGER,
          acknowledged_by TEXT,
          FOREIGN KEY (agent_id) REFERENCES agents(id)
        )
      `);

      // Logs table
      this.db.run(`
        CREATE TABLE IF NOT EXISTS logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id TEXT,
          level TEXT,
          message TEXT,
          metadata TEXT,
          timestamp INTEGER,
          FOREIGN KEY (agent_id) REFERENCES agents(id)
        )
      `);

      // Users table for admin access
      this.db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          username TEXT UNIQUE,
          password_hash TEXT,
          role TEXT DEFAULT 'admin',
          created_at INTEGER,
          last_login INTEGER
        )
      `);
    });
  }

  // Promise helpers
  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function(err) {
        if (err) return reject(err);
        resolve(this.changes);
      });
    });
  }

  get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
  }

  all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
  }

  // Agent methods
  registerAgent(agent) {
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO agents 
        (id, hostname, platform, public_key, status, last_heartbeat, registered_at, config, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run(
        agent.id,
        agent.hostname,
        agent.platform,
        agent.publicKey,
        'online',
        Date.now(),
        Date.now(),
        JSON.stringify(agent.config || {}),
        JSON.stringify(agent.metadata || {}),
        (err) => {
          if (err) reject(err);
          else resolve(agent.id);
        }
      );
      stmt.finalize();
    });
  }

  updateAgentStatus(agentId, status, lastHeartbeat) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE agents SET status = ?, last_heartbeat = ? WHERE id = ?',
        [status, lastHeartbeat || Date.now(), agentId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  getAgent(agentId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM agents WHERE id = ?',
        [agentId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  getAllAgents() {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM agents ORDER BY registered_at DESC', (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  updateAgentMetadata(agentId, metadata) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE agents SET metadata = ? WHERE id = ?',
        [JSON.stringify(metadata), agentId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  // Token methods
  createToken(token, expiresIn = 3600000, metadata = null) { // 1 hour default
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO registration_tokens (token, created_at, expires_at, metadata) VALUES (?, ?, ?, ?)',
        [token, Date.now(), Date.now() + expiresIn, metadata ? JSON.stringify(metadata) : null],
        (err) => {
          if (err) reject(err);
          else resolve(token);
        }
      );
    });
  }

  validateToken(token) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM registration_tokens WHERE token = ? AND used_at IS NULL AND expires_at > ?',
        [token, Date.now()],
        (err, row) => {
          if (err) reject(err);
          else resolve(row || null);
        }
      );
    });
  }

  useToken(token, agentId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE registration_tokens SET used_at = ?, used_by = ? WHERE token = ?',
        [Date.now(), agentId, token],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  // Alert methods
  createAlert(agentId, level, message, details) {
    return new Promise((resolve, reject) => {
      const id = require('uuid').v4();
      this.db.run(
        'INSERT INTO alerts (id, agent_id, level, message, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, agentId, level, message, JSON.stringify(details || {}), Date.now()],
        (err) => {
          if (err) reject(err);
          else resolve(id);
        }
      );
    });
  }

  getAlerts(limit = 100, offset = 0) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM alerts ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [limit, offset],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  // Log methods
  createLog(agentId, level, message, metadata) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO logs (agent_id, level, message, metadata, timestamp) VALUES (?, ?, ?, ?, ?)',
        [agentId, level, message, JSON.stringify(metadata || {}), Date.now()],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  getLogs(agentId, limit = 100, offset = 0) {
    return new Promise((resolve, reject) => {
      const query = agentId 
        ? 'SELECT * FROM logs WHERE agent_id = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?'
        : 'SELECT * FROM logs ORDER BY timestamp DESC LIMIT ? OFFSET ?';
      const params = agentId ? [agentId, limit, offset] : [limit, offset];
      
      this.db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  close() {
    this.db.close();
  }
}

module.exports = Database;