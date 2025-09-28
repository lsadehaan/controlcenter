'use strict';

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class GitHttpServer {
  constructor(gitServer, logger) {
    this.gitServer = gitServer;
    this.logger = logger || console;
    this.router = express.Router();
    
    this.setupRoutes();
  }
  
  setupRoutes() {
    // Git Smart HTTP protocol endpoints
    
    // GET /info/refs - Used for fetching refs (discovery)
    this.router.get('/:repo/info/refs', (req, res) => {
      const service = req.query.service;
      
      if (!service) {
        // Dumb HTTP protocol
        const refsPath = path.join(this.gitServer.repoPath, 'info', 'refs');
        if (fs.existsSync(refsPath)) {
          res.sendFile(refsPath);
        } else {
          res.status(404).send('Not found');
        }
        return;
      }
      
      // Smart HTTP protocol
      const serviceName = service.replace('git-', '');
      
      res.setHeader('Content-Type', `application/x-${service}-advertisement`);
      res.write(this.pktLine(`# service=${service}\n`));
      res.write('0000');
      
      const gitProcess = spawn('git', [serviceName, '--stateless-rpc', '--advertise-refs', this.gitServer.repoPath]);
      
      gitProcess.stdout.pipe(res);
      
      gitProcess.stderr.on('data', (data) => {
        this.logger.error('Git process error:', data.toString());
      });
      
      gitProcess.on('error', (err) => {
        this.logger.error('Failed to spawn git process:', err);
        if (!res.headersSent) {
          res.status(500).send('Internal server error');
        }
      });
    });
    
    // POST /git-upload-pack - Used for fetching objects (clone/pull)
    this.router.post('/:repo/git-upload-pack', (req, res) => {
      res.setHeader('Content-Type', 'application/x-git-upload-pack-result');
      
      const gitProcess = spawn('git', ['upload-pack', '--stateless-rpc', this.gitServer.repoPath]);
      
      req.pipe(gitProcess.stdin);
      gitProcess.stdout.pipe(res);
      
      gitProcess.stderr.on('data', (data) => {
        this.logger.error('Git upload-pack error:', data.toString());
      });
      
      gitProcess.on('error', (err) => {
        this.logger.error('Failed to spawn git upload-pack:', err);
        if (!res.headersSent) {
          res.status(500).send('Internal server error');
        }
      });
      
      gitProcess.on('close', (code) => {
        if (code !== 0) {
          this.logger.error(`Git upload-pack exited with code ${code}`);
        }
      });
    });
    
    // POST /git-receive-pack - Used for pushing objects (not needed for read-only)
    this.router.post('/:repo/git-receive-pack', (req, res) => {
      // For now, we'll make this read-only
      res.status(403).send('Push access denied');
    });
    
    // Static file serving for dumb HTTP protocol
    this.router.get('/:repo/HEAD', (req, res) => {
      // Security: Validate repo name to prevent path traversal
      if (req.params.repo.includes('..') || req.params.repo.includes('/') || req.params.repo.includes('\\')) {
        return res.status(400).send('Invalid repository name');
      }

      const headPath = path.join(this.gitServer.repoPath, 'HEAD');
      const resolvedPath = path.resolve(headPath);

      // Security: Ensure resolved path is within repo directory
      if (!resolvedPath.startsWith(path.resolve(this.gitServer.repoPath))) {
        return res.status(403).send('Access denied');
      }

      if (fs.existsSync(resolvedPath)) {
        res.sendFile(resolvedPath);
      } else {
        res.status(404).send('Not found');
      }
    });

    this.router.get('/:repo/objects/:dir/:file', (req, res) => {
      // Security: Validate all parameters to prevent path traversal
      const { repo, dir, file } = req.params;

      if ([repo, dir, file].some(param =>
        param.includes('..') || param.includes('/') || param.includes('\\'))) {
        return res.status(400).send('Invalid path parameters');
      }

      // Security: Use path.resolve to get absolute path and verify it's within bounds
      const objectPath = path.join(this.gitServer.repoPath, 'objects', dir, file);
      const resolvedPath = path.resolve(objectPath);
      const baseRepoPath = path.resolve(this.gitServer.repoPath);

      // Ensure the resolved path is within the repository directory
      if (!resolvedPath.startsWith(baseRepoPath)) {
        return res.status(403).send('Access denied');
      }

      if (fs.existsSync(resolvedPath)) {
        res.sendFile(resolvedPath);
      } else {
        res.status(404).send('Not found');
      }
    });
    
    // Middleware to log Git operations
    this.router.use((req, res, next) => {
      this.logger.log(`Git HTTP: ${req.method} ${req.path}`);
      next();
    });
  }
  
  // Helper function to create pkt-line format
  pktLine(data) {
    const length = data.length + 4;
    const hex = length.toString(16).padStart(4, '0');
    return hex + data;
  }
  
  getRouter() {
    return this.router;
  }
}

module.exports = GitHttpServer;