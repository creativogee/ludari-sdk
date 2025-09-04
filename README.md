<h1 align="center">
  Ludari
</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/@crudmates/ludari"><img alt="NPM version" src="https://img.shields.io/npm/v/@crudmates/ludari.svg"></a>
  <a href="https://www.npmjs.com/package/@crudmates/ludari"><img alt="NPM downloads" src="https://img.shields.io/npm/dw/@crudmates/ludari.svg"></a>
  <a href="https://www.paypal.com/donate?hosted_button_id=Z9NGDEGSC3LPY" target="_blank"><img alt="Donate PayPal" src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg"></a>
</p>

Self‑hosted, type‑safe job orchestration for Node.js — cron and ad‑hoc runs, chaining, distributed locks, and pluggable storage/cache.

<em>Pronunciation:</em> Ludari ("ludri") · Oludari ("oh-ludri").

## Features

- **Flexible Job Scheduling**: Support for cron expressions with method and query jobs
- **Storage Interface + In-Memory Storage**: Implement your own storage; comes with an in-memory storage for testing and simple use-cases
- **Distributed Locking**: Built-in support via a Redis-backed cache implementation
- **TypeScript Support**: Full TypeScript support with comprehensive type definitions
- **Extensible Architecture**: Clear interfaces to extend storage and cache implementations

## Installation

```bash
npm install @crudmates/ludari
```

## Quick Start

### Basic Usage

```typescript
import { Manager, InMemoryStorage, InMemoryCache, BaseJobHandler, Bind } from '@crudmates/ludari';

// 1) Implement a job handler for 'method' jobs
@Bind() // Binds methods to preserve this-context
class BackupService extends BaseJobHandler {
  async performBackup(context: any) {
    console.log(`Performing backup for ${context.database}`);
    // Your backup logic here
  }
}

const handler = new BackupService();

// 2) Create storage and cache instances
const storage = new InMemoryStorage();
const cache = new InMemoryCache();

// 3) Initialize the manager
const manager = new Manager({
  storage,
  cache,
  logger: console,
  enabled: true,
  // replicaId is optional; defaults to a UUID or LUDARI_REPLICA_ID env var
  // releaseLocksOnShutdown defaults to true
});

// 4) Start the manager
await manager.initialize();

// 5) Create a method job
// NOTE: For method jobs, the job's name must match the handler method name
await manager.createJob({
  name: 'performBackup',
  type: 'method',
  enabled: true,
  cron: '0 2 * * *', // Daily at 2 AM
  context: { database: 'production', distributed: true, ttl: 30 },
});

// The manager will automatically schedule and execute jobs
```

Note: Core model fields use snake_case by default (e.g., created_at, updated_at, job_id, log_level).

### Internal Jobs

The manager automatically creates and manages internal jobs for distributed coordination:

- `__watch__` Job: An internal job used for replica synchronization and health monitoring. This job is automatically created during manager initialization and is protected from external modification. Users cannot list, retrieve, modify, or delete this job through the public API.

### Job Types

#### Method Jobs

Execute class methods by name through a `Handler` implementation. The job's `name` must match the method name on your handler class.

```typescript
import { BaseJobHandler, Bind } from '@crudmates/ludari';

@Bind()
class UserJobs extends BaseJobHandler {
  async recalcStats(context: { userId: string }) {
    // This method can be called as a job
    const data = await this._fetchUserData(context.userId);
    // ... your logic
  }

  // Private helper methods - excluded from job execution
  private async _fetchUserData(userId: string) {
    // This method cannot be called as a job (starts with underscore)
    return { userId, stats: {} };
  }

  private async internalCleanup() {
    // This method cannot be called as a job (starts with 'internal')
    // ... cleanup logic
  }
}

const handler = new UserJobs();
const manager = new Manager({ storage, cache, logger: console, enabled: true, handler });
await manager.initialize();

await manager.createJob({
  name: 'recalcStats', // must match method name
  type: 'method',
  enabled: true,
  cron: '*/5 * * * *',
  context: { userId: '123', distributed: true, ttl: 30 },
});
```

**Method Security**: Only public methods are callable as jobs. Private methods are automatically excluded if they:
- Start with underscore (`_methodName`)
- Start with common private prefixes (`internal*`, `private*`, `hidden*`)
- End with common private suffixes (`*Private`, `*Internal`)
- Are getters/setters or forbidden system methods

#### Query Jobs

Execute database queries (requires your storage implementation to support `executeQuery`). If `querySecret` is provided in `Manager` options, queries are AES-encrypted at rest and decrypted before execution.

```typescript
const manager = new Manager({
  storage,
  cache,
  logger: console,
  enabled: true,
  querySecret: 'strong-secret',
});
await manager.initialize();

await manager.createJob({
  name: 'cleanup-old-logs',
  type: 'query',
  enabled: true,
  cron: '0 3 * * *', // Daily at 3 AM
  query: 'DELETE FROM logs WHERE created_at < NOW() - INTERVAL 30 DAY',
  persist: true,
});
```

#### Inline Jobs

Execute custom functions registered at runtime:

```typescript
import { Manager, InMemoryStorage, InMemoryCache } from '@crudmates/ludari';

const storage = new InMemoryStorage();
const cache = new InMemoryCache();
const manager = new Manager({ storage, cache, logger: console, enabled: true });
await manager.initialize();

// Register an inline handler for a job named 'send-reminders'
manager.register('send-reminders', async (context, lens) => {
  // Your reminder logic here
  console.log(`Sending ${context.reminderType} reminders`);
  return { sent: true };
});

// Note: Handlers are automatically cleared on manager.destroy().
// You only need unregister if you want to hot-swap a handler at runtime.

await manager.createJob({
  name: 'send-reminders',
  type: 'inline',
  enabled: true,
  cron: '0 9 * * 1', // Every Monday at 9 AM
  context: { reminderType: 'weekly' },
});
```

### Job Chaining

Chain jobs by invoking the next job at the end of the current job’s handler. Use inline handlers and `handleJob(...)` to trigger the next step, and enable `distributed` context for safe concurrency.

```typescript
// Handlers for each step
const extract = async (ctx) => {
  // ... extract work
  await manager.handleJob('transform', transform);
};

const transform = async (ctx) => {
  // ... transform work
  await manager.handleJob('load', load);
};

const load = async (ctx) => {
  // ... load work
};

// Register handlers
manager.register('extract', extract);
manager.register('transform', transform);
manager.register('load', load);

// Create jobs (cron or ad‑hoc)
await manager.createJob({
  name: 'extract',
  type: 'inline',
  enabled: true,
  context: { distributed: true, ttl: 30 },
});
await manager.createJob({
  name: 'transform',
  type: 'inline',
  enabled: true,
  context: { distributed: true, ttl: 30 },
});
await manager.createJob({
  name: 'load',
  type: 'inline',
  enabled: true,
  context: { distributed: true, ttl: 30 },
});

// Kick off the chain manually (or wait for cron)
await manager.handleJob('extract', extract);
```

## Storage Implementations

### In-Memory Storage (included)

```typescript
import { InMemoryStorage } from '@crudmates/ludari';

const storage = new InMemoryStorage();
```

### Custom Storage (implement the `Storage` interface)

You can implement the `Storage` interface to use any database (e.g., Postgres, MongoDB, etc.). See `src/interfaces/storage.interface.ts` for the required methods.

## Cache Implementations

### In-Memory Cache (included)

```typescript
import { InMemoryCache } from '@crudmates/ludari';

const cache = new InMemoryCache();
```

### Redis Cache

`RedisCache` provides distributed locking and context storage. It expects a Redis client that matches a minimal interface (compatible with `ioredis` or `node-redis`).

```typescript
import Redis from 'ioredis';
import { RedisCache } from '@crudmates/ludari';

const redis = new Redis('redis://localhost:6379');
const cache = new RedisCache(redis, { keyPrefix: 'cron:', debug: false });
```

## Distributed Locking

```typescript
// Acquire a distributed lock
const lock = await cache.acquireLock('resource-key', {
  ttlMs: 5000,
  value: 'unique-identifier',
});

if (lock.acquired) {
  try {
    // Perform your critical operation
    await performCriticalOperation();
  } finally {
    // Always release the lock
    await cache.releaseLock('resource-key', lock.lockValue!);
  }
}
```

## Job Context and Batching

```typescript
// Set job context for coordination
await cache.setJobContext('data-processing', {
  batchId: 'batch-123',
  totalRecords: 1000,
  processedRecords: 0,
});

// Increment batch counters
const currentCount = await cache.incrementBatch('data-processing');
```

## API Reference (Selected)

### Manager Options

```typescript
interface ManagerOptions {
  replicaId?: string;
  storage: Storage;
  cache?: Cache;
  logger?: any;
  handler?: Handler;
  querySecret?: string;
  enabled?: boolean;
  watchInterval?: number; // clamped to [1..5] seconds, default 5
  releaseLocksOnShutdown?: boolean; // default: true
}
```

### Manager Inline APIs

```typescript
// Register or remove inline job handlers by name
manager.register(name: string, handler: (ctx?: any, lens?: Lens) => Promise<any>): void;
manager.unregister(name: string): void; // optional; auto-cleared on destroy
```

### Storage Interface

```typescript
interface Storage {
  // Control operations
  getControl(): Promise<Control | null>;
  createControl(data: CreateControl): Promise<Control>;
  updateControl(id: string, data: UpdateControl): Promise<Control>;

  // Job operations
  findJobs(filter?: JobFilter): Promise<PaginatedResponse<Job>>;
  findJob(id: string): Promise<Job | null>;
  findJobByName(name: string): Promise<Job | null>;
  createJob(data: CreateJob): Promise<Job>;
  updateJob(id: string, data: UpdateJob): Promise<Job>;
  deleteJob(id: string): Promise<void>;

  // Job run operations
  createJobRun(data: CreateJobRun): Promise<JobRun>;
  updateJobRun(id: string, data: UpdateJobRun): Promise<JobRun>;
  findJobRuns(filter?: JobRunFilter): Promise<PaginatedResponse<JobRun>>;

  // Optional query support
  executeQuery?(sql: string): Promise<any>;
}
```

### Cache Interface

```typescript
interface Cache {
  // Distributed locking
  acquireLock(key: string, options: LockOptions): Promise<LockResult>;
  releaseLock(key: string, value: string): Promise<boolean>;
  extendLock(key: string, value: string, ttlMs: number): Promise<boolean>;

  // Job context
  setJobContext(jobName: string, context: Record<string, any>, ttlMs?: number): Promise<void>;
  getJobContext(jobName: string): Promise<Record<string, any> | null>;
  deleteJobContext(jobName: string): Promise<void>;

  // Batching
  incrementBatch(jobName: string): Promise<number>;
  getBatch(jobName: string): Promise<number>;
  resetBatch(jobName: string): Promise<void>;

  // Health and cleanup
  isHealthy(): Promise<boolean>;
  cleanup?(): Promise<void>;
  destroy?(): Promise<void>;
}
```

## Configuration

### Environment Variables (example)

```bash
# Cache configuration
REDIS_URL=redis://localhost:6379

# Manager configuration
LUDARI_REPLICA_ID=server-1
LUDARI_ENABLED=true
```

### Logging

You can pass any logger that implements `error`, `warn`, `log`, and `debug`. For simple usage, `console` works.

```typescript
const manager = new Manager({
  storage,
  cache,
  logger: console,
  enabled: true,
});
```

## Testing

```typescript
import { InMemoryStorage, InMemoryCache, Manager } from '@crudmates/ludari';

describe('My Job Tests', () => {
  let manager: Manager;
  let storage: InMemoryStorage;
  let cache: InMemoryCache;

  beforeEach(async () => {
    storage = new InMemoryStorage();
    cache = new InMemoryCache();

    manager = new Manager({
      storage,
      cache,
      logger: console,
      enabled: true,
    });

    await manager.initialize();
  });

  afterEach(async () => {
    await manager.destroy();
    await cache.destroy?.();
    await storage.clear?.();
  });

  it('should execute a job', async () => {
    // Your test logic here
  });
});
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

Bold, simple, and production‑ready—run Ludari self‑hosted with full ownership of your infrastructure. Design complex workflows with type‑safe APIs, cron or ad‑hoc executions, and first‑class chaining powered by dynamic context. Enforce reliability with per‑job lifecycle controls and distributed locks for safe concurrency across replicas. Add security with optional query encryption and tailor persistence via pluggable storage/cache. Ship faster, operate safer, and scale confidently—without lock‑in or hidden costs.

## Support

If Ludari helps you, please consider supporting the project by buying me a coffee:

<p align="center">
  <a href="https://github.com/crudmates/ludari">⭐ Star on GitHub</a>
  ·
  <a href="https://www.paypal.com/donate?hosted_button_id=Z9NGDEGSC3LPY">Buy me a coffee</a>
</p>
