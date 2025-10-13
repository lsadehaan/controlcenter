# Feature Plan: step-ca Integration for Certificate Management

**Target Release:** v0.16.0 (Future)
**Status:** Planning
**Created:** 2025-10-13
**Owner:** TBD

## Overview

Integrate Smallstep's step-ca (Certificate Authority) into Control Center to provide enterprise-grade PKI capabilities for air-gapped deployments. This will enable automated certificate management for the manager, agents, and other internal services.

## Business Value

### Problem Statement

Current air-gapped deployments require:
- Manual certificate generation with OpenSSL
- Manual certificate renewal and distribution
- No centralized certificate lifecycle management
- Complex setup for users unfamiliar with PKI

### Solution

Integrate step-ca to provide:
- ✅ One-click certificate issuance and renewal
- ✅ Centralized certificate management UI
- ✅ HSM support for production deployments
- ✅ Automatic certificate renewal (ACME protocol)
- ✅ mTLS between agents and manager (future)
- ✅ Certificate revocation and audit trail

### Success Metrics

- Reduce time to set up HTTPS from 30+ minutes to < 5 minutes
- Enable automated certificate renewal (zero downtime)
- Support HSM-backed CAs for enterprise security requirements
- Provide certificate audit trail for compliance

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                  Control Center Manager                      │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │                    Manager UI                         │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐     │  │
│  │  │ Dashboard  │  │  Settings  │  │   Agents   │     │  │
│  │  └────────────┘  └────────────┘  └────────────┘     │  │
│  │                        │                              │  │
│  │                  ┌─────▼──────┐                       │  │
│  │                  │ CA Manager │  ◄─── New Feature    │  │
│  │                  │   UI Tab   │                       │  │
│  │                  └─────┬──────┘                       │  │
│  └────────────────────────┼───────────────────────────────┘  │
│                           │                                  │
│  ┌────────────────────────▼───────────────────────────────┐  │
│  │            CA Service Layer (Node.js)                   │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │ - Certificate request/renewal                     │  │  │
│  │  │ - Certificate storage and tracking                │  │  │
│  │  │ - Automatic renewal scheduling                    │  │  │
│  │  │ - Audit logging                                   │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────┬───────────────────────────────┘  │
│                           │ REST API                         │
└───────────────────────────┼──────────────────────────────────┘
                            │
                            │ HTTPS
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                      step-ca Server                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  CA Engine                                            │  │
│  │  - Certificate issuance (REST API)                    │  │
│  │  - ACME server (auto-renewal)                         │  │
│  │  - Certificate revocation                             │  │
│  │  - Provisioner management                             │  │
│  └────────────────────────┬─────────────────────────────┘  │
│                           │                                  │
│  ┌────────────────────────▼─────────────────────────────┐  │
│  │  Key Storage                                          │  │
│  │  - File-based (development)                           │  │
│  │  - PKCS#11 HSM (production)                           │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Deployment Options

#### Option A: Sidecar Deployment (Recommended)

```yaml
version: '3.8'

services:
  manager:
    image: ghcr.io/lsadehaan/controlcenter-manager:v0.16.0
    environment:
      - STEP_CA_URL=https://step-ca:9000
      - STEP_CA_FINGERPRINT=${CA_FINGERPRINT}
    networks:
      - controlcenter

  step-ca:
    image: smallstep/step-ca:latest
    volumes:
      - step-ca-data:/home/step
      # Optional: Mount HSM device
      # devices:
      #   - /dev/tpm0
    networks:
      - controlcenter
    ports:
      - "9000:9000"

  nginx:
    image: nginx:alpine
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - certs:/etc/nginx/ssl:ro  # ← Auto-renewed by manager
    networks:
      - controlcenter
    ports:
      - "443:443"
      - "80:80"

networks:
  controlcenter:
    driver: bridge

volumes:
  step-ca-data:
  certs:
```

#### Option B: External CA

Control Center connects to existing step-ca deployment:

```bash
# Manager environment variables
STEP_CA_URL=https://ca.company.internal:9000
STEP_CA_ROOT=/path/to/root_ca.crt
STEP_CA_PROVISIONER=controlcenter
STEP_CA_PROVISIONER_PASSWORD_FILE=/run/secrets/ca_password
```

### Database Schema

Add new tables to track certificates:

```sql
-- Certificate Authority configuration
CREATE TABLE ca_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ca_url TEXT NOT NULL,                    -- step-ca URL
    ca_fingerprint TEXT NOT NULL,            -- Root CA fingerprint
    provisioner_name TEXT NOT NULL,          -- Provisioner to use
    provisioner_kid TEXT,                    -- Key ID
    enabled BOOLEAN DEFAULT 0,               -- CA integration enabled
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Issued certificates tracking
CREATE TABLE certificates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cert_type TEXT NOT NULL,                 -- 'manager', 'agent', 'service'
    common_name TEXT NOT NULL,               -- CN from certificate
    san_dns TEXT,                            -- DNS SANs (JSON array)
    san_ips TEXT,                            -- IP SANs (JSON array)
    serial_number TEXT UNIQUE,               -- Certificate serial number
    fingerprint TEXT UNIQUE,                 -- SHA256 fingerprint
    not_before DATETIME NOT NULL,            -- Validity start
    not_after DATETIME NOT NULL,             -- Validity end
    auto_renew BOOLEAN DEFAULT 1,            -- Auto-renewal enabled
    renewal_threshold_days INTEGER DEFAULT 7,-- Renew when < N days left
    certificate_path TEXT,                   -- Path to cert file
    key_path TEXT,                           -- Path to key file
    status TEXT DEFAULT 'active',            -- active, expired, revoked
    agent_id TEXT,                           -- FK to agents (if agent cert)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX idx_certificates_not_after ON certificates(not_after);
CREATE INDEX idx_certificates_status ON certificates(status);
CREATE INDEX idx_certificates_agent_id ON certificates(agent_id);

-- Certificate renewal history
CREATE TABLE certificate_renewals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    certificate_id INTEGER NOT NULL,
    old_serial_number TEXT,
    new_serial_number TEXT,
    old_not_after DATETIME,
    new_not_after DATETIME,
    renewal_method TEXT,                     -- 'manual', 'automatic'
    status TEXT NOT NULL,                    -- 'success', 'failed'
    error_message TEXT,
    renewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (certificate_id) REFERENCES certificates(id) ON DELETE CASCADE
);

CREATE INDEX idx_renewals_certificate_id ON certificate_renewals(certificate_id);
CREATE INDEX idx_renewals_renewed_at ON certificate_renewals(renewed_at);
```

## Implementation Phases

### Phase 1: Foundation (v0.16.0)

**Goal:** Basic step-ca integration and manager certificate management

**Features:**
- CA configuration UI in Settings
- Connect to existing step-ca instance
- Request certificate for manager
- Display current certificate info (expiry, SANs, etc.)
- Download root CA certificate
- Manual certificate renewal

**Components:**
1. Backend service: `src/services/ca-service.js`
   - step-ca client library integration
   - Certificate request/renewal logic
   - Certificate storage and tracking

2. API routes: `src/routes/ca.js`
   - `POST /api/ca/configure` - Configure CA connection
   - `GET /api/ca/status` - Get CA status and connectivity
   - `POST /api/ca/request` - Request new certificate
   - `POST /api/ca/renew/:id` - Renew certificate
   - `GET /api/ca/certificates` - List all certificates
   - `GET /api/ca/root` - Download root CA certificate

3. UI: `views/ca-manager.ejs`
   - CA configuration form
   - Certificate list with status
   - Certificate details modal
   - Manual renewal button
   - Download root CA button

4. Database migrations:
   - Create ca_config table
   - Create certificates table
   - Create certificate_renewals table

**Technical Requirements:**
- Use `@smallstep/step-ca-client` npm package
- Certificate files stored in `data/certificates/`
- Support both password and SSH provisioners
- Validate CA fingerprint on connection
- Handle certificate chain properly

**Testing:**
- Unit tests for CA service methods
- Integration tests with real step-ca instance
- Mock tests for API routes
- End-to-end tests for certificate request flow

**Documentation:**
- Setup guide for step-ca deployment
- Configuration reference
- Troubleshooting guide
- API documentation

### Phase 2: Automation (v0.17.0)

**Goal:** Automatic certificate renewal and monitoring

**Features:**
- Automatic certificate renewal daemon
- Certificate expiry monitoring
- Alert when certificates are expiring
- Automatic nginx reload after renewal
- Certificate renewal history
- Renewal failure notifications

**Components:**
1. Renewal daemon: `src/services/cert-renewal-daemon.js`
   - Check certificates daily
   - Renew if < 7 days until expiry
   - Retry failed renewals
   - Trigger nginx reload on success

2. Alert integration:
   - Warning alert at 30 days before expiry
   - Critical alert at 7 days before expiry
   - Alert on renewal failure

3. UI enhancements:
   - Certificate health dashboard
   - Renewal history timeline
   - Auto-renewal configuration per cert

**Technical Requirements:**
- Background job scheduler (node-cron or bull)
- File watching for certificate changes
- Graceful nginx reload mechanism
- Configurable renewal thresholds

### Phase 3: Agent Certificates (v0.18.0)

**Goal:** Issue certificates for agents (mTLS)

**Features:**
- Agents request client certificates on registration
- Manager validates agent certificates
- mTLS between agents and manager
- Certificate-based agent authentication
- Agent certificate rotation

**Components:**
1. Agent certificate provisioner:
   - Automatic cert request on agent startup
   - Store agent cert in `~/.controlcenter-agent/`
   - Present cert on WebSocket connection

2. Manager mTLS verification:
   - Require client certificates
   - Validate against CA
   - Map certificate CN to agent ID

3. API endpoints:
   - `POST /api/ca/agents/:id/request` - Request agent cert
   - `GET /api/ca/agents/:id/certificate` - Get agent cert status

**Technical Requirements:**
- Update agent Go code for certificate handling
- WebSocket TLS configuration
- Certificate revocation list (CRL) support

### Phase 4: Advanced Features (v0.19.0+)

**Goal:** Enterprise-grade certificate lifecycle management

**Features:**
- Certificate revocation
- ACME protocol support (automatic renewal)
- Certificate templates
- Multiple CAs (dev, staging, prod)
- HSM configuration UI
- Certificate audit reports
- Compliance reporting

**Components:**
1. Certificate revocation:
   - Revoke compromised certificates
   - CRL generation and distribution
   - OCSP responder support

2. ACME client:
   - Automatic challenge/response
   - DNS-01 or HTTP-01 challenges
   - Zero-touch renewal

3. Advanced UI:
   - Certificate template editor
   - Audit log viewer
   - Compliance dashboard
   - HSM status monitoring

## API Design

### REST API Endpoints

```javascript
// CA Configuration
POST   /api/ca/configure
GET    /api/ca/status
PUT    /api/ca/configure
DELETE /api/ca/configure

// Certificates
GET    /api/ca/certificates
POST   /api/ca/certificates/request
GET    /api/ca/certificates/:id
PUT    /api/ca/certificates/:id/renew
DELETE /api/ca/certificates/:id/revoke

// Root CA
GET    /api/ca/root/download
GET    /api/ca/root/fingerprint

// Agent Certificates (Phase 3)
POST   /api/ca/agents/:id/certificates/request
GET    /api/ca/agents/:id/certificates
PUT    /api/ca/agents/:id/certificates/:certId/renew
```

### Example API Calls

**Configure CA Connection:**
```javascript
POST /api/ca/configure
{
  "caUrl": "https://ca.company.internal:9000",
  "caFingerprint": "abc123...",
  "provisionerName": "controlcenter",
  "provisionerPassword": "secretpassword",
  "enabled": true
}

Response 200:
{
  "success": true,
  "caStatus": {
    "connected": true,
    "caVersion": "0.24.4",
    "provisioners": ["controlcenter", "admin"]
  }
}
```

**Request Certificate for Manager:**
```javascript
POST /api/ca/certificates/request
{
  "commonName": "controlcenter.company.local",
  "sanDNS": ["controlcenter.company.local", "controlcenter"],
  "sanIPs": ["192.168.1.100"],
  "certType": "manager",
  "validityDays": 365,
  "autoRenew": true
}

Response 200:
{
  "success": true,
  "certificate": {
    "id": 1,
    "serialNumber": "123456789",
    "fingerprint": "sha256:abc...",
    "notBefore": "2025-10-13T00:00:00Z",
    "notAfter": "2026-10-13T00:00:00Z",
    "certificatePath": "/app/data/certificates/manager.crt",
    "keyPath": "/app/data/certificates/manager.key"
  }
}
```

**Get Certificate Status:**
```javascript
GET /api/ca/certificates

Response 200:
{
  "certificates": [
    {
      "id": 1,
      "certType": "manager",
      "commonName": "controlcenter.company.local",
      "serialNumber": "123456789",
      "notAfter": "2026-10-13T00:00:00Z",
      "daysUntilExpiry": 358,
      "status": "active",
      "autoRenew": true,
      "lastRenewal": null
    }
  ]
}
```

## UI Design

### Settings > Certificate Authority Tab

**CA Configuration Section:**
```
┌─────────────────────────────────────────────────────────┐
│ Certificate Authority Configuration                      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ [ ] Enable CA Integration                               │
│                                                          │
│ CA URL:          [https://ca.company.local:9000_____]   │
│ CA Fingerprint:  [abc123...___________________________] │
│                  [Test Connection]                       │
│                                                          │
│ Provisioner:     [controlcenter_________] [dropdown]    │
│ Password:        [••••••••••••••••••••••] [show/hide]   │
│                                                          │
│                  [Save Configuration]                    │
└─────────────────────────────────────────────────────────┘
```

**Certificates Section:**
```
┌─────────────────────────────────────────────────────────┐
│ Certificates                            [Request New]    │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 🟢 Manager Certificate                              │ │
│ │ CN: controlcenter.company.local                     │ │
│ │ Expires: 2026-10-13 (358 days)                      │ │
│ │ Auto-renew: ✓ Enabled                               │ │
│ │                                                      │ │
│ │ [View Details] [Renew Now] [Download]               │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 🟢 nginx Certificate                                │ │
│ │ CN: nginx.company.local                             │ │
│ │ Expires: 2026-08-15 (299 days)                      │ │
│ │ Auto-renew: ✓ Enabled                               │ │
│ │                                                      │ │
│ │ [View Details] [Renew Now] [Download]               │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**Root CA Section:**
```
┌─────────────────────────────────────────────────────────┐
│ Root CA Certificate                                      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ Issuer: CN=ControlCenter Internal CA                    │
│ Fingerprint: SHA256:abc123...                           │
│                                                          │
│ [Download Root CA]  [View Certificate]                  │
│                                                          │
│ 📝 Install this certificate on client machines to       │
│    avoid browser security warnings.                     │
│    See installation guide ↗                             │
└─────────────────────────────────────────────────────────┘
```

### Dashboard Widget (Phase 2)

Add certificate status to main dashboard:

```
┌─────────────────────────────────────────┐
│ Certificate Health              [Expand] │
├─────────────────────────────────────────┤
│ ✓ 2 certificates active                 │
│ ⚠ 0 expiring soon (< 30 days)          │
│ ✗ 0 expired                             │
│                                         │
│ Next renewal: 2026-09-15 (in 335 days) │
└─────────────────────────────────────────┘
```

## Configuration

### Environment Variables

```bash
# step-ca connection
STEP_CA_ENABLED=true
STEP_CA_URL=https://ca.company.local:9000
STEP_CA_FINGERPRINT=abc123...
STEP_CA_PROVISIONER=controlcenter
STEP_CA_PROVISIONER_PASSWORD=secret

# Certificate paths
CERT_STORAGE_PATH=/app/data/certificates
MANAGER_CERT_PATH=/app/data/certificates/manager.crt
MANAGER_KEY_PATH=/app/data/certificates/manager.key

# Auto-renewal settings
CERT_RENEWAL_CHECK_INTERVAL=86400  # seconds (24h)
CERT_RENEWAL_THRESHOLD_DAYS=7
CERT_RENEWAL_ENABLED=true
```

### Config File (config.js)

```javascript
module.exports = {
  // ... existing config ...

  ca: {
    enabled: process.env.STEP_CA_ENABLED === 'true',
    url: process.env.STEP_CA_URL || 'https://localhost:9000',
    fingerprint: process.env.STEP_CA_FINGERPRINT,
    provisioner: {
      name: process.env.STEP_CA_PROVISIONER || 'controlcenter',
      password: process.env.STEP_CA_PROVISIONER_PASSWORD,
      kid: process.env.STEP_CA_PROVISIONER_KID
    },
    certificates: {
      storagePath: process.env.CERT_STORAGE_PATH || path.join(dataDir, 'certificates'),
      manager: {
        certPath: process.env.MANAGER_CERT_PATH,
        keyPath: process.env.MANAGER_KEY_PATH
      }
    },
    renewal: {
      enabled: process.env.CERT_RENEWAL_ENABLED !== 'false',
      checkInterval: parseInt(process.env.CERT_RENEWAL_CHECK_INTERVAL) || 86400,
      thresholdDays: parseInt(process.env.CERT_RENEWAL_THRESHOLD_DAYS) || 7
    }
  }
};
```

## Security Considerations

### Secrets Management

1. **Provisioner Password:**
   - Never store in database
   - Use environment variable or secrets file
   - Support Docker secrets: `/run/secrets/ca_provisioner_password`

2. **Private Keys:**
   - Store in `data/certificates/` with 0600 permissions
   - Never expose via API
   - Consider encryption at rest (future)

3. **CA Root Fingerprint:**
   - Verify on every connection
   - Alert if fingerprint changes (MITM detection)

### Permissions

Add new permissions to user roles:

```sql
INSERT INTO permissions (name, description) VALUES
  ('ca.view', 'View CA configuration and certificates'),
  ('ca.configure', 'Configure CA connection'),
  ('ca.request', 'Request new certificates'),
  ('ca.renew', 'Renew certificates'),
  ('ca.revoke', 'Revoke certificates');
```

Default admin role gets all CA permissions.

### Audit Logging

Log all CA operations:

```javascript
{
  "event": "certificate.requested",
  "user": "admin@company.com",
  "timestamp": "2025-10-13T12:00:00Z",
  "details": {
    "commonName": "controlcenter.company.local",
    "certType": "manager",
    "validityDays": 365
  }
}

{
  "event": "certificate.renewed",
  "user": "system",
  "timestamp": "2026-10-06T03:00:00Z",
  "details": {
    "certificateId": 1,
    "oldSerial": "123456789",
    "newSerial": "987654321",
    "method": "automatic"
  }
}
```

## Testing Strategy

### Unit Tests

```javascript
// test/services/ca-service.test.js
describe('CAService', () => {
  describe('requestCertificate', () => {
    it('should request certificate from step-ca', async () => {
      const cert = await caService.requestCertificate({
        commonName: 'test.local',
        sanDNS: ['test.local'],
        validityDays: 365
      });

      expect(cert).toHaveProperty('serialNumber');
      expect(cert).toHaveProperty('notAfter');
    });

    it('should throw error if CA not configured', async () => {
      await expect(
        caService.requestCertificate({ commonName: 'test' })
      ).rejects.toThrow('CA not configured');
    });
  });

  describe('renewCertificate', () => {
    it('should renew certificate before expiry', async () => {
      // Test implementation
    });
  });
});
```

### Integration Tests

```javascript
// test/integration/ca-api.test.js
describe('CA API Endpoints', () => {
  let app, server, caContainer;

  beforeAll(async () => {
    // Start step-ca container for testing
    caContainer = await startStepCAContainer();
    app = createApp({ caUrl: caContainer.url });
    server = app.listen(0);
  });

  afterAll(async () => {
    await caContainer.stop();
    await server.close();
  });

  test('POST /api/ca/configure', async () => {
    const res = await request(app)
      .post('/api/ca/configure')
      .send({
        caUrl: caContainer.url,
        caFingerprint: caContainer.fingerprint,
        provisionerName: 'test',
        provisionerPassword: 'testpass'
      });

    expect(res.status).toBe(200);
    expect(res.body.caStatus.connected).toBe(true);
  });
});
```

### End-to-End Tests

```javascript
// test/e2e/certificate-lifecycle.test.js
describe('Certificate Lifecycle', () => {
  test('Complete certificate request and renewal flow', async () => {
    // 1. Configure CA
    await configureCa();

    // 2. Request certificate
    const cert = await requestCertificate();
    expect(cert.status).toBe('active');

    // 3. Verify certificate stored
    const certPath = path.join(certDir, 'manager.crt');
    expect(fs.existsSync(certPath)).toBe(true);

    // 4. Renew certificate
    const renewed = await renewCertificate(cert.id);
    expect(renewed.serialNumber).not.toBe(cert.serialNumber);

    // 5. Verify renewal logged
    const history = await getRenewalHistory(cert.id);
    expect(history).toHaveLength(1);
  });
});
```

## Migration Strategy

### For Existing Deployments

Users upgrading from v0.15.x to v0.16.0:

1. **Database migration runs automatically** on startup
   - Creates ca_config, certificates, certificate_renewals tables
   - No data loss

2. **Existing certificates not affected**
   - CA integration is opt-in
   - Manual certificates continue to work
   - Users can migrate incrementally

3. **Migration path:**
   ```bash
   # Before: Manual self-signed cert
   - Manager uses /etc/nginx/ssl/manager.crt

   # After: step-ca managed cert
   - Configure CA in Settings
   - Request new certificate
   - Update nginx to use new cert path
   - Old cert can be removed
   ```

### Rollback Plan

If CA integration causes issues:

```bash
# Disable CA integration
export STEP_CA_ENABLED=false

# Manager falls back to existing certificate configuration
# No data loss, CA tables remain but unused
```

## Documentation Requirements

### User Documentation

1. **Setup Guide:**
   - How to deploy step-ca alongside Control Center
   - Initial CA configuration steps
   - Requesting first certificate
   - Configuring nginx to use CA-issued certs

2. **Operation Guide:**
   - Certificate renewal (manual and automatic)
   - Monitoring certificate expiry
   - Troubleshooting certificate issues
   - Revoking compromised certificates

3. **HSM Guide:**
   - Supported HSM vendors
   - PKCS#11 configuration
   - YubiHSM setup example
   - CloudHSM setup example

4. **Architecture Guide:**
   - How CA integration works
   - mTLS between agents (Phase 3)
   - Certificate templates
   - Best practices for certificate lifecycle

### Developer Documentation

1. **API Reference:**
   - All CA endpoints documented
   - Request/response examples
   - Error codes and handling

2. **Integration Guide:**
   - How to use CA service in code
   - Adding new certificate types
   - Custom provisioners

## Dependencies

### npm Packages

```json
{
  "dependencies": {
    "@smallstep/step-ca-client": "^1.0.0",  // step-ca client library
    "node-cron": "^3.0.0",                   // Scheduling for renewal daemon
    "x509": "^1.0.0"                         // Certificate parsing
  }
}
```

### External Services

- **step-ca:** Version 0.24.4 or later
- **OpenSSL:** For certificate inspection/validation

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| CA unavailable during renewal | High - Expired certs | Implement retry logic, alert 30 days before expiry |
| Private key compromise | Critical | Store keys with restrictive permissions, support HSM |
| CA configuration error | Medium - No new certs | Comprehensive validation, test connection button |
| Certificate renewal failure | High - Service outage | Alert on failure, manual renewal option, multiple retry attempts |
| step-ca version incompatibility | Medium - Integration breaks | Pin to specific version, integration tests with multiple versions |
| Performance impact | Low - API slowness | Async certificate operations, caching where appropriate |

## Success Criteria

### Phase 1 (v0.16.0)

- [ ] User can configure CA connection via UI
- [ ] User can request certificate for manager
- [ ] User can download root CA certificate
- [ ] User can manually renew certificates
- [ ] All certificates tracked in database
- [ ] UI shows certificate expiry warnings
- [ ] Documentation complete
- [ ] 90% test coverage

### Phase 2 (v0.17.0)

- [ ] Automatic renewal daemon working
- [ ] Certificates renewed within 7 days of expiry
- [ ] nginx automatically reloaded after renewal
- [ ] Alerts sent on renewal failure
- [ ] Renewal history visible in UI
- [ ] Zero-downtime certificate renewal

### Phase 3 (v0.18.0)

- [ ] Agents can request client certificates
- [ ] mTLS working between agents and manager
- [ ] Agent authentication via certificate
- [ ] Agent certificates auto-renew

## Future Enhancements

Beyond v0.19.0:

1. **Web UI for step-ca:** Embed step-ca web UI in manager (iframe)
2. **Certificate templates:** Pre-defined templates for common cert types
3. **Multi-CA support:** Different CAs for dev/staging/prod
4. **Certificate discovery:** Scan network for expiring certs
5. **Compliance reports:** Generate audit reports for security teams
6. **SSH certificates:** Issue SSH certificates for agent access (not just TLS)
7. **SCEP support:** For legacy device enrollment
8. **Certificate monitoring dashboard:** Real-time cert health across all services

## References

- [Smallstep step-ca Documentation](https://smallstep.com/docs/step-ca)
- [PKCS#11 Specification](https://docs.oasis-open.org/pkcs11/pkcs11-base/v2.40/os/pkcs11-base-v2.40-os.html)
- [RFC 5280 - X.509 PKI Certificates](https://datatracker.ietf.org/doc/html/rfc5280)
- [RFC 8555 - ACME Protocol](https://datatracker.ietf.org/doc/html/rfc8555)
- [Mozilla SSL Configuration Generator](https://ssl-config.mozilla.org/)

## Appendix

### Example step-ca Configuration

Minimal `ca.json` for Control Center integration:

```json
{
  "root": "/home/step/certs/root_ca.crt",
  "crt": "/home/step/certs/intermediate_ca.crt",
  "key": "/home/step/secrets/intermediate_ca_key",
  "address": ":9000",
  "dnsNames": ["ca.company.local"],
  "logger": {"format": "text"},
  "db": {
    "type": "badgerv2",
    "dataSource": "/home/step/db"
  },
  "authority": {
    "provisioners": [
      {
        "type": "JWK",
        "name": "controlcenter",
        "key": {
          "use": "sig",
          "kty": "EC",
          "kid": "abc123",
          "crv": "P-256",
          "alg": "ES256",
          "x": "...",
          "y": "..."
        },
        "encryptedKey": "...",
        "claims": {
          "minTLSCertDuration": "5m",
          "maxTLSCertDuration": "8760h",
          "defaultTLSCertDuration": "8760h"
        }
      }
    ]
  }
}
```

### Docker Compose Example

Complete example with HSM support:

```yaml
version: '3.8'

services:
  step-ca:
    image: smallstep/step-ca:latest
    container_name: step-ca
    hostname: ca.company.local
    environment:
      - DOCKER_STEPCA_INIT_NAME=ControlCenter CA
      - DOCKER_STEPCA_INIT_DNS_NAMES=ca.company.local,localhost
      - DOCKER_STEPCA_INIT_PROVISIONER=controlcenter
    volumes:
      - step-ca-data:/home/step
      # HSM device (example: YubiHSM)
      # - /usr/lib/libykcs11.so:/usr/lib/libykcs11.so:ro
      # devices:
      #   - /dev/bus/usb
    networks:
      - controlcenter
    ports:
      - "9000:9000"
    restart: unless-stopped

  manager:
    image: ghcr.io/lsadehaan/controlcenter-manager:v0.16.0
    container_name: controlcenter-manager
    depends_on:
      - step-ca
    environment:
      - NODE_ENV=production
      - JWT_SECRET=${JWT_SECRET}
      - STEP_CA_ENABLED=true
      - STEP_CA_URL=https://step-ca:9000
      - STEP_CA_FINGERPRINT=${CA_FINGERPRINT}
      - STEP_CA_PROVISIONER=controlcenter
      - STEP_CA_PROVISIONER_PASSWORD_FILE=/run/secrets/ca_password
    volumes:
      - manager-data:/app/data
      - shared-certs:/app/data/certificates
    secrets:
      - ca_password
    networks:
      - controlcenter
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    container_name: controlcenter-nginx
    depends_on:
      - manager
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
      - shared-certs:/etc/nginx/ssl:ro
    networks:
      - controlcenter
    ports:
      - "443:443"
      - "80:80"
    restart: unless-stopped

networks:
  controlcenter:
    driver: bridge

volumes:
  step-ca-data:
  manager-data:
  shared-certs:

secrets:
  ca_password:
    file: ./secrets/ca_password.txt
```

---

**Last Updated:** 2025-10-13
**Status:** Planning - Ready for Review
**Next Steps:**
1. Review and refine plan
2. Create GitHub issue/project board
3. Estimate effort for Phase 1
4. Begin implementation in v0.16.0 development cycle
