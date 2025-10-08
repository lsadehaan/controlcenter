'use strict';

const simpleGit = require('simple-git');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

class GitServer {
  constructor(repoPath, logger) {
    this.repoPath = repoPath || path.join(__dirname, '../../data/config-repo');
    this.logger = logger || console;
    
    // Ensure repo directory exists
    if (!fs.existsSync(this.repoPath)) {
      fs.mkdirSync(this.repoPath, { recursive: true });
    }
    
    this.git = simpleGit(this.repoPath);
    this.init();
  }

  async init() {
    try {
      // Check if already initialized
      const isRepo = await this.git.checkIsRepo();
      
      if (!isRepo) {
        await this.git.init();
        await this.git.addConfig('user.name', 'Control Center');
        await this.git.addConfig('user.email', 'admin@controlcenter.local');
        // Allow updating the checked-out branch via pushes
        await this.git.addConfig('receive.denyCurrentBranch', 'updateInstead');
        
        // Create initial structure
        this.createInitialStructure();
        
        await this.git.add('.');
        await this.git.commit('Initial configuration repository');
        
        this.logger.log('Git repository initialized at', this.repoPath);
      } else {
        // Ensure config is set for existing repositories
        try {
          await this.git.addConfig('receive.denyCurrentBranch', 'updateInstead');
          this.logger.log("Configured 'receive.denyCurrentBranch=updateInstead' for repo", this.repoPath);
        } catch (cfgErr) {
          this.logger.warn("Failed to set 'receive.denyCurrentBranch' (non-fatal):", cfgErr.message || cfgErr);
        }
      }
    } catch (err) {
      this.logger.error('Failed to initialize git repository:', err);
    }
  }

  createInitialStructure() {
    // Create directories for agent configs
    const dirs = ['agents', 'workflows', 'templates'];
    dirs.forEach(dir => {
      const dirPath = path.join(this.repoPath, dir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }
    });
    
    // Create README
    const readme = `# Control Center Configuration Repository

This repository contains configurations for all agents and workflows.

## Structure
- /agents/     - Individual agent configurations
- /workflows/  - Workflow definitions
- /templates/  - Configuration templates

## Usage
Agents will clone and pull from this repository to sync their configurations.
`;
    
    fs.writeFileSync(path.join(this.repoPath, 'README.md'), readme);
  }

  async saveAgentConfig(agentId, config) {
    const configPath = path.join(this.repoPath, 'agents', `${agentId}.json`);
    
    try {
      // Ensure agents directory exists
      const agentsDir = path.join(this.repoPath, 'agents');
      if (!fs.existsSync(agentsDir)) {
        fs.mkdirSync(agentsDir, { recursive: true });
      }
      
      // Write config file
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      
      // Commit changes
      await this.git.add(configPath);
      await this.git.commit(`Update configuration for agent ${agentId}`);
      
      this.logger.log(`Saved configuration for agent ${agentId}`);
      return true;
    } catch (err) {
      this.logger.error('Failed to save agent config:', err);
      return false;
    }
  }

  async getAgentConfig(agentId) {
    const configPath = path.join(this.repoPath, 'agents', `${agentId}.json`);
    
    try {
      if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(data);
      }
      return null;
    } catch (err) {
      this.logger.error('Failed to read agent config:', err);
      return null;
    }
  }

  async saveWorkflow(workflowId, workflow) {
    const workflowPath = path.join(this.repoPath, 'workflows', `${workflowId}.json`);
    
    try {
      // Ensure workflows directory exists
      const workflowsDir = path.join(this.repoPath, 'workflows');
      if (!fs.existsSync(workflowsDir)) {
        fs.mkdirSync(workflowsDir, { recursive: true });
      }
      
      // Write workflow file
      fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));
      
      // Commit changes
      await this.git.add(workflowPath);
      await this.git.commit(`Update workflow ${workflow.name || workflowId}`);
      
      this.logger.log(`Saved workflow ${workflowId}`);
      return true;
    } catch (err) {
      this.logger.error('Failed to save workflow:', err);
      return false;
    }
  }

  async deployWorkflowToAgent(workflowId, agentId) {
    try {
      // Read workflow
      const workflowPath = path.join(this.repoPath, 'workflows', `${workflowId}.json`);
      if (!fs.existsSync(workflowPath)) {
        throw new Error('Workflow not found');
      }
      const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
      
      // Read agent config
      const agentConfig = await this.getAgentConfig(agentId) || { workflows: [] };
      
      // Add or update workflow in agent config
      const existingIndex = agentConfig.workflows.findIndex(w => w.id === workflowId);
      if (existingIndex >= 0) {
        agentConfig.workflows[existingIndex] = workflow;
      } else {
        agentConfig.workflows.push(workflow);
      }
      
      // Save updated agent config
      await this.saveAgentConfig(agentId, agentConfig);
      
      return true;
    } catch (err) {
      this.logger.error('Failed to deploy workflow:', err);
      return false;
    }
  }

  async getCommitHistory(limit = 10) {
    try {
      const log = await this.git.log({ n: limit });
      return log.all;
    } catch (err) {
      this.logger.error('Failed to get commit history:', err);
      return [];
    }
  }

  async getStatus() {
    try {
      const status = await this.git.status();
      return status;
    } catch (err) {
      this.logger.error('Failed to get git status:', err);
      return null;
    }
  }

  // Create a bare clone URL for agents
  getCloneUrl() {
    // In production, this would return an actual git:// or https:// URL
    // For now, return the file path
    return `file://${this.repoPath}`;
  }

  // Handle git operations from agents
  async handleGitRequest(operation, params) {
    switch (operation) {
      case 'clone':
        return { url: this.getCloneUrl() };
        
      case 'pull':
        // In a real implementation, this would handle authentication
        // and return the latest commits
        return { success: true };
        
      case 'fetch':
        return await this.getCommitHistory(params.limit || 10);
        
      default:
        throw new Error(`Unknown git operation: ${operation}`);
    }
  }
}

module.exports = GitServer;