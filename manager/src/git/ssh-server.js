'use strict';

const ssh2 = require('ssh2');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class GitSSHServer {
  constructor(gitServer, db, logger, port = 2222) {
    this.gitServer = gitServer;
    this.db = db;
    this.logger = logger || console;
    this.port = port;
    this.server = null;

    // Generate host keys if they don't exist
    this.hostKeyPath = path.join(__dirname, '../../data/ssh_host_rsa_key');
    this.ensureHostKey();
  }

  ensureHostKey() {
    if (!fs.existsSync(this.hostKeyPath)) {
      this.logger.log('Generating SSH host key...');

      // Create data directory if it doesn't exist
      const dataDir = path.dirname(this.hostKeyPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      // Generate RSA key pair
      const { privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: {
          type: 'spki',
          format: 'pem'
        },
        privateKeyEncoding: {
          type: 'pkcs1',
          format: 'pem'
        }
      });

      fs.writeFileSync(this.hostKeyPath, privateKey, { mode: 0o600 });
      this.logger.log('SSH host key generated');
    }
  }

  async start() {
    const hostKey = fs.readFileSync(this.hostKeyPath);

    this.server = new ssh2.Server({
      hostKeys: [hostKey]
    }, (client) => {
      this.handleClient(client);
    });

    this.server.listen(this.port, '0.0.0.0', () => {
      this.logger.log(`Git SSH server listening on port ${this.port}`);
    });

    this.server.on('error', (err) => {
      this.logger.error('Git SSH server error:', err);
    });
  }

  async handleClient(client) {
    let authContext = {
      agentId: null,
      publicKey: null
    };

    this.logger.log('Git SSH client connected');

    client.on('authentication', async (ctx) => {
      if (ctx.method === 'publickey') {
        const publicKey = ctx.key.data.toString('base64');

        // Find agent by public key
        const agents = await this.db.getAllAgents();
        const agent = agents.find(a => {
          // Compare the public key data
          // The key from database is in OpenSSH format, need to extract the data part
          if (!a.public_key) return false;

          try {
            // Extract base64 part from "ssh-rsa AAAAB3... comment" format
            const keyParts = a.public_key.trim().split(' ');
            if (keyParts.length >= 2) {
              const storedKeyData = keyParts[1];
              const incomingKeyData = publicKey;
              return storedKeyData === incomingKeyData;
            }
          } catch (err) {
            this.logger.error('Error comparing keys:', err);
          }
          return false;
        });

        if (agent) {
          authContext.agentId = agent.id;
          authContext.publicKey = publicKey;
          this.logger.log(`Git SSH authentication successful for agent ${agent.id}`);
          ctx.accept();
        } else {
          this.logger.warn('Git SSH authentication failed: unknown public key');
          ctx.reject();
        }
      } else {
        ctx.reject();
      }
    });

    client.on('ready', () => {
      this.logger.log(`Git SSH client ready (agent: ${authContext.agentId})`);

      client.on('session', (accept, reject) => {
        const session = accept();

        session.once('exec', (accept, reject, info) => {
          this.logger.log(`Git SSH exec command: ${info.command}`);

          // Parse git command
          const cmdMatch = info.command.match(/^(git-upload-pack|git-receive-pack|git upload-pack|git receive-pack)\s+'?([^']+)'?$/);

          if (!cmdMatch) {
            this.logger.warn(`Invalid git command: ${info.command}`);
            reject();
            return;
          }

          const gitCommand = cmdMatch[1].replace(/^git\s+/, 'git-');
          const repoPath = cmdMatch[2];

          // Security: Only allow access to config-repo
          if (!repoPath.endsWith('/config-repo') && !repoPath.endsWith('/config-repo.git') && repoPath !== 'config-repo') {
            this.logger.warn(`Access denied to repository: ${repoPath}`);
            reject();
            return;
          }

          const stream = accept();

          // Execute git command
          this.executeGitCommand(gitCommand, this.gitServer.repoPath, stream, authContext.agentId);
        });
      });
    });

    client.on('end', () => {
      this.logger.log('Git SSH client disconnected');
    });

    client.on('error', (err) => {
      this.logger.error('Git SSH client error:', err);
    });
  }

  executeGitCommand(command, repoPath, stream, agentId) {
    this.logger.log(`Executing ${command} for agent ${agentId} in ${repoPath}`);

    // Use explicit git command path without shell
    const gitCmd = command.includes('upload-pack') ? 'git-upload-pack' : 'git-receive-pack';
    const isPush = command.includes('receive-pack');

    // For non-bare repos, we need to pass the .git directory
    const gitDir = path.join(repoPath, '.git');
    const targetPath = fs.existsSync(gitDir) ? gitDir : repoPath;

    this.logger.log(`Using git directory: ${targetPath}`);
    this.logger.log(`Git command: ${gitCmd} ${targetPath}`);

    // For SSH, use stateful protocol (no --stateless-rpc)
    const gitProcess = spawn(gitCmd, [targetPath]);

    // Log and forward stderr for debugging and client progress
    let stderrData = '';
    gitProcess.stderr.on('data', (data) => {
      const text = data.toString();
      stderrData += text;
      this.logger.warn(`Git stderr: ${text.trim()}`);
    });

    if (stream.stderr && typeof stream.stderr.write === 'function') {
      // Do not auto-end SSH channel on stderr finish; we'll close explicitly
      gitProcess.stderr.pipe(stream.stderr, { end: false }).on('error', (err) => {
        this.logger.error(`Stderr to SSH channel error: ${err.message}`);
      });
    }

    // Pipe streams with error handling
    stream.pipe(gitProcess.stdin).on('error', (err) => {
      this.logger.error(`Stream to stdin error: ${err.message}`);
    });

    // Do not auto-end SSH channel on stdout finish; we'll close explicitly
    gitProcess.stdout.pipe(stream, { end: false }).on('error', (err) => {
      this.logger.error(`Stdout to stream error: ${err.message}`);
    });

    // Handle stream errors
    stream.on('error', (err) => {
      this.logger.error(`SSH stream error: ${err.message}`);
      if (!gitProcess.killed) {
        gitProcess.kill();
      }
    });

    gitProcess.stdin.on('error', (err) => {
      this.logger.error(`Git stdin error: ${err.message}`);
    });

    gitProcess.stdout.on('error', (err) => {
      this.logger.error(`Git stdout error: ${err.message}`);
    });

    gitProcess.on('error', (err) => {
      this.logger.error(`Git process error: ${err.message}`);
      this.logger.error(`Command was: ${gitCmd} ${targetPath}`);
      stream.exit(1);
      stream.end();
    });

    let gitClosed = false;

    gitProcess.on('exit', (code, signal) => {
      if (code !== 0 || signal) {
        this.logger.warn(`Git process exited with code ${code}, signal ${signal}`);
        if (stderrData) {
          this.logger.error(`Git stderr summary: ${stderrData}`);
        }
      } else {
        this.logger.log(`Git process completed successfully`);

        // If this was a push, sync the database with the updated config
        if (isPush && code === 0) {
          this.syncDatabaseAfterPush(agentId).catch(err => {
            this.logger.error(`Failed to sync database after push for agent ${agentId}:`, err);
          });
        }
      }
      // Send exit status before closing the channel
      try {
        stream.exit(Number.isInteger(code) ? code : 0);
      } catch (e) {
        this.logger.error(`Error sending SSH exit status: ${e.message}`);
      }
      // Close channel on next tick to ensure exit-status is flushed first
      process.nextTick(() => {
        try {
          if (typeof stream.close === 'function') {
            stream.close();
          } else {
            stream.end();
          }
        } catch (e) {
          this.logger.error(`Error closing SSH stream: ${e.message}`);
        }
      });
    });

    gitProcess.on('close', (code, signal) => {
      gitClosed = true;
      this.logger.log(`Git process streams closed (code=${code}, signal=${signal})`);
    });

    stream.on('close', () => {
      this.logger.log('SSH stream closed');
      if (!gitClosed && !gitProcess.killed) {
        this.logger.log('Killing git process due to premature stream close');
        gitProcess.kill();
      }
    });
  }

  async syncDatabaseAfterPush(agentId) {
    try {
      this.logger.log(`Syncing database for agent ${agentId} after push`);

      // Read the agent's config from the Git repository
      const agentConfig = await this.gitServer.getAgentConfig(agentId);

      if (!agentConfig) {
        this.logger.warn(`No config file found for agent ${agentId} in repository`);
        return;
      }

      // Update the agent's config in the database
      await this.db.updateAgentConfig(agentId, agentConfig);

      this.logger.log(`Successfully synced database for agent ${agentId}`);
    } catch (err) {
      this.logger.error(`Error syncing database for agent ${agentId}:`, err);
      throw err;
    }
  }

  stop() {
    if (this.server) {
      this.server.close(() => {
        this.logger.log('Git SSH server stopped');
      });
    }
  }
}

module.exports = GitSSHServer;
