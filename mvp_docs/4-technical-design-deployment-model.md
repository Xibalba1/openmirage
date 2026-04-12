# OpenMirage Technical Design: Deployment Model

### **1\. Scope**

MVP deployment should be a **small number of processes on one VPS**, not a distributed platform. The goal is operational simplicity, low cost, self-hostability, and a clean path to future scaling only if usage demands it. Docker Compose is the intended deployment mechanism.

### **2\. What runs on the VPS**

The initial VPS should run these main processes:

* **Caddy** for TLS termination and reverse proxying,  
* **frontend assets** for the React/Vite client,  
* **Fastify API** for auth, metadata APIs, comments, sharing, asset metadata, and export job creation,  
* **Hocuspocus collaboration service** for page-scoped websocket sync and awareness,  
* **PostgreSQL** as the relational system of record,  
* **bounded worker** for exports, thumbnails, and cleanup tasks.

Blob storage may be external and should remain replaceable. For **local development**, the preferred default should be a self-hosted S3-compatible service such as **MinIO** so the development environment matches production-style object-storage behavior closely. For **staging**, the system should support either self-hosted MinIO or an external S3-compatible provider such as R2. **Local filesystem storage** may still exist as a minimal fallback for strict self-hosting or emergency simplicity, but it should not be treated as the preferred primary path. Email may also be external if used for invites or notifications.

### **3\. Backups**

Backups are a first-class operational requirement. The most important priority is **Postgres backup and restore**. Offsite backup storage is explicitly allowed, especially if separated from primary asset storage. In practice, backup scope should cover:

* Postgres,  
* blob storage or local asset storage,  
* deployment configuration needed to recreate the stack.

MVP platform completion should require not just configured backups, but at least **one successful tested restore** performed against a clean target environment.

### **4\. Logs and secrets**

The deployment should prioritize **configuration clarity** and **observability sufficient for debugging**. That implies each service should emit logs in a way Docker Compose and the VPS operator can inspect easily, without adding heavyweight infrastructure in MVP. Secrets should be treated as deployment configuration for the VPS and external dependencies, not embedded in application code. The main secrets are likely database credentials, session/auth secrets, blob storage credentials, and email provider credentials. The specific secret mechanism is not fixed in the source docs and can remain an implementation detail.

### **5\. Observability baseline**

The MVP observability baseline should remain intentionally lightweight while still being sufficient for local debugging and single-VPS operations.

At minimum, the deployment should provide:

* structured service logs,  
* health and/or readiness endpoints for each main service,  
* lightweight metrics suitable for Docker Compose and VPS inspection,  
* and enough visibility to distinguish failures in the API, collaboration service, worker, and storage dependencies.

The MVP does **not** require a heavyweight monitoring or centralized log-processing stack.

### **6\. Recovery**

Recovery should assume the single-server model can fail hard. The recovery path should therefore be simple:

1. reprovision the VPS,  
2. redeploy the Docker Compose stack,  
3. restore Postgres,  
4. reconnect or restore blob storage,  
5. verify the API, collaboration service, and worker come up cleanly.

The restore procedure should be documented and verified at least once against a clean target environment.

A key rule is that heavy worker jobs must remain isolated enough that failed or oversized exports do not degrade the API or websocket collaboration path.

The design rule is: **one VPS, few processes, explicit backups, simple recovery, minimal operational machinery**.
