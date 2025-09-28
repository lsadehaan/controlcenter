# **Project Blueprint: Distributed Control Center (Hybrid Architecture)**

Version: 2.0  
Date: September 9, 2025  
Status: PROPOSED

## **1\. Executive Summary**

### **1.1. Vision**

The Distributed Control Center is an enterprise-grade automation platform designed to replace disparate, script-based tasks with a centrally managed, visually configured, and highly observable system. It provides a single "pane of glass" for administrators to build, deploy, and monitor complex workflows that span multiple servers and data centers. By combining a powerful visual editor with a secure, distributed architecture, the platform aims to dramatically increase operational reliability, security, and efficiency.

### **1.2. Core Principles**

* **Centralize Control, Distribute Execution:** Configuration and monitoring happen in one place; work happens where the data is.  
* **Visualize, Don't Script:** Empower users to build complex logic without writing code, reducing errors and increasing clarity.  
* **Security by Default:** Implement industry-standard, battle-tested security protocols for all communication.  
* **Audit Everything:** Provide a complete, versioned history of all configuration changes and a detailed audit trail of all actions.  
* **Build for Resilience:** Ensure that individual component failures do not lead to data loss or dangerous duplicate processing.

## **2\. System Architecture**

The platform is built on a hybrid-technology, hub-and-spoke model. This architecture is designed to optimize for both high-performance execution at the edge and a rich, interactive user experience at the center.

### **2.1. The Control Center (Management Server)**

A central **Node.js** application that serves as the brain of the operation. The choice of Node.js is strategic, leveraging its world-class ecosystem for rapidly building modern, real-time web applications.

* **Web UI & API Server:** The single, browser-based interface for all administration.  
* **Agent Registry:** Manages the registration, identity, and real-time status (online/offline, last heartbeat) of all connected Agents.  
* **Security Authority:** Manages a central registry of Agent public SSH keys and automates their secure distribution.  
* **Configuration Hub:** Hosts an integrated Git server as the single source of truth for all Agent configurations.  
* **Observability Hub:**  
  * **Alerting Service:** Ingests and stores high-priority alerts from Agents.  
  * **Log Ingestion Service:** Receives high-volume diagnostic logs from the Log Shipping Layer.  
* **Notification Gateway:** Forwards critical alerts to external channels (Email, Slack, etc.).

### **2.2. The Agent (Processor Node)**

A lightweight, high-performance, headless **Golang** service. Go is chosen for its ability to compile to a single, dependency-free native binary, making deployment trivial and resource consumption minimal.

* **Secure Bootstrapping:** On first run, generates a unique SSH key pair for its identity.  
* **Registration & Health Checks:** Registers with the Control Center by providing its public key. It maintains a persistent WebSocket connection to the Control Center, sending regular **heartbeats** to signal its health and online status.  
* **Configuration Sync:** Clones its configuration from the Control Center's Git server and hot-reloads it upon receiving a pull command.  
* **Workflow Executor:** The core engine that runs the visual workflows defined in its configuration.  
* **State Manager:** Manages a local state.json transaction journal to ensure workflows can be safely recovered after a crash.  
* **Secure Services:**  
  * **SSH/SFTP Server:** An embedded server for receiving secure commands and files from other authorized Agents.  
  * **Local Logger:** Writes structured (JSON) diagnostic logs to a local file for pickup by a log shipper.  
  * **Alerting Client:** Sends critical alerts directly to the Control Center's Alerting Service.

### **2.3. The Log Shipping Layer (Third-Party)**

A required component of a complete deployment, consisting of a standard log shipping agent (e.g., Filebeat, Promtail) installed alongside each Agent.

## **3\. Security Model: Zero-Trust Communication**

The security model is based on SSH public key cryptography, managed centrally by the Control Center to eliminate manual key management.

1. **Agent Identity:** Each Go Agent has its own unique SSH key pair. The private key never leaves the Agent.  
2. **Registration:** An Agent registers with the Control Center by presenting its public key and a one-time registration token.  
3. **Centralized Trust:** The Control Center becomes the single source of truth for every Agent's public key.  
4. **Automated Authorization:** When an administrator designs a workflow where Agent-A needs to communicate with Agent-B, the Control Center automatically adds Agent-A's public key to the authorizedSshKeys list in Agent-B's configuration file and triggers a git pull on Agent-B.  
5. **Secure Execution:** When the workflow runs, Agent-A connects to Agent-B's SSH server and authenticates using its private key.

## **4\. The Visual Workflow Engine**

Workflows are built in the Control Center UI and executed by the Go Agents.

* **Triggers:**  
  * File System Trigger: Watches for file system events.  
  * Scheduled Trigger: Runs workflows on a cron-like schedule.  
  * Webhook Trigger: Starts a workflow from an external HTTP request.  
* **Steps:** Core actions available in the visual builder.  
  * **File System:** Move File, Copy File, Delete File, Rename File.  
  * **Execution:** Run Local Command, Run Remote Command (SSH).  
  * **Network:** Send File (SFTP), Make HTTP Request.  
  * **Logic:** Conditional (If/Else), For-Each Loop.  
  * **Platform:** Send Alert to Control Center.  
  * **Custom:** Execute JavaScript (run on the Agent via an embedded JS interpreter like goja).

## **5\. Technology Stack**

* **Control Center (Node.js):**  
  * **Backend:** Node.js, Express.js  
  * **Git Server:** nodegit or a wrapper around the git CLI.  
  * **Real-time:** ws (WebSockets) for agent communication and UI updates.  
  * **Notifications:** Nodemailer  
  * **Database:** SQLite (default, pluggable).  
  * **Web UI:** EJS, Vanilla JavaScript, Drawflow.js.  
* **Agent (Golang):**  
  * **Web/API Client:** Standard net/http.  
  * **WebSockets:** gorilla/websocket.  
  * **SSH/SFTP:** golang.org/x/crypto/ssh.  
  * **Git Client:** go-git/go-git.  
  * **File Watching:** fsnotify.  
  * **Logging:** zerolog or zap for structured JSON logging.  
  * **JavaScript Interpreter:** goja for the Execute JavaScript step.

## **6\. Implementation Roadmap**

1. **Phase 1: Foundation & Core Services**  
   * Build the **Go Agent** with SSH key generation, registration, heartbeat logic, and config-syncing capabilities.  
   * Build the **Node.js Control Center** with Agent Registration, the Public Key Registry, and the Git server.  
   * Establish the secure WebSocket communication link for heartbeats and commands.  
2. **Phase 2: Local Workflows & UI**  
   * Implement the Workflow Executor and State Manager in the **Go Agent** for local-only Steps.  
   * Build the core UI in the **Node.js Control Center** for managing Agents and editing their configurations via the Git commit flow.  
   * Implement the File System Trigger.  
3. **Phase 3: Distributed & Secure Workflows**  
   * Implement the embedded SSH server in the **Go Agent**.  
   * Implement the automated key distribution logic in the **Control Center**.  
   * Add the distributed Steps (Remote Command, Send File) to the Visual Workflow Builder.  
4. **Phase 4: Observability & Usability**  
   * Implement the Alerting Service and Inbox UI on the **Control Center**.  
   * Implement the Log Ingestion Service and the UI for viewing logs.  
   * Add remaining Triggers and the Execute JavaScript Step (integrating goja into the Go Agent).  
   * Finalize documentation, security hardening, and user experience.