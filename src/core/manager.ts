/* istanbul ignore file */
import { CronJob } from 'cron';
import { randomUUID } from 'crypto';
import * as crypto from 'crypto-js';
import { InMemoryCache } from '../implementations/in-memory-cache';
import { Cache } from '../interfaces/cache.interface';
import { Handler } from '../interfaces/job-handler.interface';
import { Storage } from '../interfaces/storage.interface';
import {
  Control,
  CreateJob,
  Job,
  JobContext,
  JobExecution,
  JobFilter,
  JobRun,
  JobRunFilter,
  PaginatedResponse,
  UpdateControl,
  UpdateJob,
} from '../types/core';
import { Lens } from './lens';

const WATCH_JOB_NAME = '__watch__';

export interface ManagerOptions {
  replicaId?: string;
  storage: Storage;
  cache?: Cache;
  logger?: any;
  handler?: Handler;
  querySecret?: string;
  enabled?: boolean;
  watchInterval?: number;
  releaseLocksOnShutdown?: boolean;
}

/**
 * Main manager class for handling cron jobs
 */
export class Manager {
  private readonly replicaId: string;
  private readonly storage: Storage;
  private readonly cache: Cache;
  private readonly logger: ManagerOptions['logger'];
  private readonly handler?: Handler;
  private readonly querySecret?: string;
  private readonly enabled: boolean;
  private readonly watchInterval: number;
  private readonly releaseLocksOnShutdown: boolean;

  private readonly cronJobs = new Map<string, CronJob>();
  private logLevel = 'info';
  private readonly logLevels: Record<string, number> = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
  };

  private isInitialized = false;
  private isDestroyed = false;
  private isResetting = false;

  // Registered inline job handlers by job name
  private readonly inlineHandlers = new Map<string, JobExecution>();

  static readonly JobType = {
    INLINE: 'inline' as const,
    QUERY: 'query' as const,
    METHOD: 'method' as const,
  };

  constructor(options: ManagerOptions) {
    this.replicaId = options.replicaId || process.env.LUDARI_REPLICA_ID || randomUUID();
    this.storage = options.storage;
    this.cache = options.cache ?? new InMemoryCache();
    this.logger = options.logger;
    this.handler = options.handler;
    this.querySecret = options.querySecret;
    this.enabled = options.enabled ?? false;
    this.watchInterval = Math.max(1, Math.min(5, options.watchInterval ?? 5));
    this.releaseLocksOnShutdown = options.releaseLocksOnShutdown ?? true;

    this.validateConfiguration();
  }

  /**
   * Register an inline job handler function by job name
   */
  register(name: string, handler: JobExecution): void {
    if (!name || typeof handler !== 'function') {
      throw new Error('Inline handler requires a valid name and function');
    }
    this.inlineHandlers.set(name, handler);
  }

  /**
   * Unregister a previously registered inline job handler
   */
  unregister(name: string): void {
    this.inlineHandlers.delete(name);
  }

  /**
   * Validate configuration based on intended usage
   */
  private validateConfiguration(): void {
    if (!this.storage) {
      throw new Error('storage implementation is required');
    }

    if (!this.logger) {
      throw new Error('logger is required');
    }
  }

  /**
   * Initialize the manager (call this after construction)
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      await this.prepare();
      this.isInitialized = true;
      this.log.info(`Manager initialized with replicaId: ${this.replicaId}`);
    } catch (error) {
      this.log.error(
        `Initialization failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Prepare the manager state and schedule jobs
   */
  private async prepare(): Promise<void> {
    try {
      // Get or create control record
      let control = await this.storage.getControl();

      if (!control) {
        control = await this.storage.createControl({
          enabled: true,
          replicas: [this.replicaId],
          stale: [],
          version: randomUUID(),
        });
      }

      // Register this replica without marking self as stale
      if (!control.replicas.includes(this.replicaId)) {
        control.replicas.push(this.replicaId);

        await this.storage.updateControl(control.id, {
          replicas: control.replicas,
          stale: control.stale,
          version: control.version, // Use current version instead of generating new one
        });
      }

      // Ensure this replica is not marked stale to avoid immediate reset re-scheduling
      if (control.stale.includes(this.replicaId)) {
        const newStale = control.stale.filter((id) => id !== this.replicaId);
        await this.updateControlWithRetry(control.id, { stale: newStale });
      }

      // Create watch job if it doesn't exist
      const watchJob = await this.storage.findJobByName(WATCH_JOB_NAME);
      if (!watchJob) {
        await this.storage.createJob({
          name: WATCH_JOB_NAME,
          type: 'query',
          enabled: true,
          persist: false,
          cron: `*/${this.watchInterval} * * * * *`,
        });
      }

      await this.initializeJobs();
    } catch (error) {
      this.log.warn(`Prepare failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Initialize and schedule all enabled jobs
   */
  private async initializeJobs(): Promise<void> {
    try {
      const control = await this.storage.getControl();
      if (!control?.enabled || !this.enabled) {
        this.log.warn('Manager is disabled');
        return;
      }

      const jobsResponse = await this.storage.findJobs({ deleted: null });
      const jobs = jobsResponse.data;

      for (const job of jobs) {
        await this.scheduleJob(job);
      }

      const enabledCount = jobs.filter((job) => job.enabled && job.cron).length;
      this.log.info(`Scheduled ${enabledCount - 1} jobs`); // -1 for watch job
    } catch (error) {
      this.log.warn(
        `Job initialization failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Schedule a single job
   */
  private async scheduleJob(job: Job): Promise<void> {
    try {
      // If a job with the same name is already scheduled, stop and replace it
      const existingCron = this.cronJobs.get(job.name);
      if (existingCron) {
        existingCron.stop();
        this.cronJobs.delete(job.name);
      }

      if (!job.enabled || !job.cron || job.deleted) {
        return;
      }

      // Skip invalid configurations
      if (job.type === 'query' && !job.query && job.name !== WATCH_JOB_NAME) {
        return;
      }

      if (job.type === 'method' && !this.handler) {
        this.log.warn(`No job handler provided for method job: ${job.name}`);
        return;
      }

      const cronJob = new CronJob(job.cron, () => {
        this.executeJob(job).catch((error) => {
          this.log.error(
            `Job execution failed: ${job.name} - ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      });

      cronJob.start();
      this.cronJobs.set(job.name, cronJob);

      if (job.name !== WATCH_JOB_NAME) {
        this.log.info(`Scheduled job: ${job.name} (${job.cron})`);
      }
    } catch (error) {
      this.log.warn(
        `Failed to schedule job ${job.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Execute a scheduled job
   */
  private async executeJob(job: Job): Promise<void> {
    try {
      // Update log level from control
      const control = await this.storage.getControl();
      this.logLevel = control?.log_level || 'info';

      // Handle replica synchronization
      if (control && control.stale.length > 0) {
        await this.resetJobs(control);
      }

      // Skip watch job execution
      if (job.name === WATCH_JOB_NAME) {
        return;
      }

      let execution: JobExecution | undefined;

      // Prepare job execution based on type
      switch (job.type) {
        case 'query':
          if (!job.query) {
            this.log.warn(`Query job ${job.name} has no query`);
            return;
          }

          if (!this.storage.executeQuery) {
            this.log.warn('Storage does not support query execution');
            return;
          }

          execution = async () => {
            const decryptedQuery = this.decryptQuery(job.query!);
            return await this.storage.executeQuery!(decryptedQuery);
          };
          break;

        case 'method':
          execution = async (context?: JobContext, lens?: Lens) => {
            if (!this.handler) {
              this.log.warn(`No job handler registered for method jobs`);
              return;
            }
            return await this.handler.executeMethod(job.name, context || {}, lens || new Lens());
          };
          break;

        case 'inline':
          execution = async (context?: JobContext, lens?: Lens) => {
            const handler = this.inlineHandlers.get(job.name);
            if (!handler) {
              this.log.warn(`No inline handler registered for job: ${job.name}`);
              return;
            }
            return handler(context || {}, lens || new Lens());
          };
          break;

        default:
          this.log.warn(`Unsupported job type: ${job.type}`);
          return;
      }

      if (!execution) {
        this.log.warn(`Unsupported job type: ${job.type}`);
        return;
      }

      await this.handleJob(job.name, execution);
    } catch (error) {
      this.log.warn(
        `Failed to execute job ${job.name}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Reset jobs across all replicas
   */
  private async resetJobs(control: Control): Promise<void> {
    if (this.isResetting) {
      return;
    }
    this.isResetting = true;
    try {
      const isStale = control.stale.includes(this.replicaId);
      if (!isStale) {
        return;
      }

      // Stop all current jobs
      this.cronJobs.forEach((job, name) => {
        job.stop();
        this.cronJobs.delete(name);
      });

      // Reschedule all jobs
      await this.initializeJobs();

      // Get fresh control data before updating to avoid version conflicts
      const freshControl = await this.storage.getControl();
      if (freshControl && freshControl.stale.includes(this.replicaId)) {
        const staleIndex = freshControl.stale.indexOf(this.replicaId);
        if (staleIndex !== -1) {
          const newStale = [...freshControl.stale];
          newStale.splice(staleIndex, 1);

          // Use the retry helper to handle version conflicts gracefully
          await this.updateControlWithRetry(freshControl.id, {
            stale: newStale,
          });
        }
      }

      this.log.info('Jobs reset completed');
    } catch (error) {
      if (error instanceof Error && error.message.includes('version mismatch')) {
        // Version conflict - another replica updated it, which is fine
        this.log.debug('Control updated by another replica during job reset');
      } else {
        this.log.warn(
          `Reset jobs failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } finally {
      this.isResetting = false;
    }
  }

  /**
   * Handle job execution with distributed locking
   */
  async handleJob(name: string, execution: JobExecution): Promise<void> {
    if (this.isDestroyed) {
      return;
    }

    if (!name) {
      throw new Error('Job name is required');
    }

    const job = await this.storage.findJobByName(name);
    if (!job || !job.enabled || job.deleted) {
      return;
    }

    const lens = new Lens();
    let jobRun: any = null;
    let lockValue: string | undefined;
    const lockKey = `lock:${name}`;

    try {
      // Create job record if not silent
      if (job.persist === true) {
        jobRun = await this.storage.createJobRun({
          job_id: job.id,
          started: new Date(),
        });
      }

      // Get context (static + dynamic)
      let context: JobContext = job.context || {};

      if (context.distributed) {
        const dynamicContext = await this.cache.getJobContext(name);
        if (dynamicContext) {
          context = { ...context, ...dynamicContext };
        }
      }

      // Handle distributed locking
      if (context.distributed) {
        const ttl = (context.ttl || 30) * 1000;

        const lockResult = await this.cache.acquireLock(lockKey, { ttlMs: ttl });

        if (!lockResult.acquired) {
          this.log.debug(`Failed to acquire lock for job: ${name}`);
          return;
        }

        lockValue = lockResult.lockValue;
        // Track active lock for cleanup on shutdown
        if (lockValue) {
          this.activeLocks.set(lockKey, lockValue);
        }
        if (!job.silent) {
          this.log.info(`Job started: ${name}`);
        }
      } else {
        if (!job.silent) {
          this.log.info(`Job started: ${name}`);
        }
      }

      // Execute the job
      const result = await execution(context, lens);

      // Handle runOnce
      if (context.runOnce) {
        await this.storage.updateJob(job.id, { enabled: false });
      }

      // Update job record
      if (jobRun) {
        await this.storage.updateJobRun(jobRun.id, {
          completed: new Date(),
          result: this.serializeResult(result, lens),
        });
      }

      if (!job.silent) {
        this.log.info(`Job completed: ${name}`);
      }
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      lens.captureError(errorObj, 'Job execution failed');

      if (jobRun) {
        await this.storage.updateJobRun(jobRun.id, {
          failed: new Date(),
          result: lens.getFrames(),
        });
      }

      this.log.warn(`Job failed: ${name} - ${errorObj.message}`);
    } finally {
      // Release lock
      if (lockValue) {
        await this.cache.releaseLock(lockKey, lockValue);
        this.activeLocks.delete(lockKey);
      }
    }
  }

  /**
   * Create a new job
   */
  async createJob(data: CreateJob): Promise<Job> {
    this.ensureInitialized();

    this.validateJobData(data);

    // Encrypt query if provided
    if (data.query && this.querySecret) {
      data.query = this.encryptQuery(data.query);
    }

    const job = await this.storage.createJob(data);

    // Trigger job reset if this is a scheduled job
    if (['query', 'method'].includes(data.type) && data.cron) {
      await this.triggerReset();
    }

    this.log.info(`Job created: ${job.name}`);
    return job;
  }

  /**
   * Update job configuration
   */
  async updateJob(id: string, data: UpdateJob): Promise<Job> {
    this.ensureInitialized();

    const existingJob = await this.storage.findJob(id);
    if (existingJob && this.isWatchJob(existingJob)) {
      throw new Error('Cannot modify __watch__ jobs');
    }

    this.validateJobData(data, true);

    // Encrypt query if provided
    if (data.query && this.querySecret) {
      data.query = this.encryptQuery(data.query);
    }

    // Handle dynamic context updates
    if (data.context) {
      const job = await this.storage.findJob(id);
      if (job) {
        await this.cache.setJobContext(job.name, data.context);
      }
    }

    const updatedJob = await this.storage.updateJob(id, data);

    // Trigger job reset for scheduled jobs
    if (['query', 'method'].includes(updatedJob.type)) {
      await this.triggerReset();
    }

    this.log.info(`Job updated: ${updatedJob.name}`);
    return updatedJob;
  }

  /**
   * Toggle job enabled/disabled state
   */
  async toggleJob(name: string): Promise<Job> {
    this.ensureInitialized();

    if (!name) {
      throw new Error('Job name is required');
    }

    const job = await this.storage.findJobByName(name);
    if (!job) {
      throw new Error(`Job not found: ${name}`);
    }

    // Prevent operations on __watch__ jobs
    if (this.isWatchJob(job)) {
      throw new Error('Cannot modify __watch__ jobs');
    }

    return this.updateJob(job.id, { enabled: !job.enabled });
  }

  /**
   * Enable job configuration
   */
  async enableJob(id: string): Promise<Job> {
    this.ensureInitialized();

    if (!id) {
      throw new Error('Job ID is required');
    }

    const job = await this.storage.findJob(id);
    if (!job) {
      throw new Error(`Job not found: ${id}`);
    }

    // Prevent operations on __watch__ jobs
    if (this.isWatchJob(job)) {
      throw new Error('Cannot modify __watch__ jobs');
    }

    if (job.enabled) {
      return job; // Already enabled, return as-is
    }

    return this.updateJob(id, { enabled: true });
  }

  /**
   * Disable job configuration
   */
  async disableJob(id: string): Promise<Job> {
    this.ensureInitialized();

    if (!id) {
      throw new Error('Job ID is required');
    }

    const job = await this.storage.findJob(id);
    if (!job) {
      throw new Error(`Job not found: ${id}`);
    }

    // Prevent operations on __watch__ jobs
    if (this.isWatchJob(job)) {
      throw new Error('Cannot modify __watch__ jobs');
    }

    if (!job.enabled) {
      return job; // Already disabled, return as-is
    }

    return this.updateJob(id, { enabled: false });
  }

  /**
   * Get job configuration by ID
   */
  async getJob(id: string): Promise<Job | null> {
    this.ensureInitialized();

    if (!id) {
      throw new Error('Job ID is required');
    }

    const job = await this.storage.findJob(id);
    if (job && this.isWatchJob(job)) {
      return null; // Hide __watch__ jobs from external access
    }
    return job;
  }

  /**
   * Delete job configuration
   */
  async deleteJob(id: string): Promise<void> {
    this.ensureInitialized();

    if (!id) {
      throw new Error('Job ID is required');
    }

    const job = await this.storage.findJob(id);

    if (!job) {
      throw new Error(`Job not found: ${id}`);
    }

    // Prevent operations on __watch__ jobs
    if (this.isWatchJob(job)) {
      throw new Error('Cannot delete __watch__ jobs');
    }

    // Stop the job if it's running
    const cronJob = this.cronJobs.get(job.name);

    if (cronJob) {
      cronJob.stop();
      this.cronJobs.delete(job.name);
    }

    await this.storage.deleteJob(id);
    this.log.info(`Deleted job configuration: ${job.name}`);
  }

  /**
   * List job execution history
   */
  async listJobRuns(filter?: JobRunFilter): Promise<PaginatedResponse<JobRun>> {
    this.ensureInitialized();

    const jobRunsResponse = await this.storage.findJobRuns(filter);
    return jobRunsResponse;
  }

  // Add listJobs method that lists job definitions (not execution history)
  async listJobs(filter?: JobFilter): Promise<PaginatedResponse<Job>> {
    this.ensureInitialized();

    const jobsResponse = await this.storage.findJobs(filter);
    // Ensure __watch__ job is never returned
    const filteredData = jobsResponse.data.filter((job) => !this.isWatchJob(job));
    return {
      ...jobsResponse,
      data: filteredData,
    };
  }

  /**
   * Get control information
   */
  async getControl(): Promise<Control | null> {
    this.ensureInitialized();

    return this.storage.getControl();
  }

  /**
   * Toggle global control
   */
  async toggleControl(): Promise<{ enabled: boolean }> {
    this.ensureInitialized();

    // Get the latest control to avoid version conflicts
    const control = await this.storage.getControl();

    if (!control) {
      throw new Error('Control not found');
    }

    const updated = await this.storage.updateControl(control.id, {
      enabled: !control.enabled,
      // Don't pass version to avoid conflicts - let storage handle versioning
    });

    this.log.info(`Manager ${updated.enabled ? 'enabled' : 'disabled'}`);
    return { enabled: updated.enabled };
  }

  /**
   * Destroy the manager and clean up resources
   */
  async destroy(): Promise<void> {
    if (this.isDestroyed) {
      return;
    }

    this.isDestroyed = true;

    // Stop all jobs
    this.cronJobs.forEach((job, name) => {
      job.stop();
      this.log.info(`Stopped job: ${name}`);
    });
    this.cronJobs.clear();

    // Release locks if configured
    if (this.releaseLocksOnShutdown) {
      for (const [key, value] of this.activeLocks.entries()) {
        try {
          await this.cache.releaseLock(key, value);
        } catch (err) {
          this.log.debug(`Failed to release lock '${key}' on shutdown`);
        }
      }
      this.activeLocks.clear();
    }

    // Clear inline handlers to avoid retaining references after shutdown
    this.inlineHandlers.clear();

    // Destroy cache if it supports it (proper cleanup with interval clearing)
    if (this.cache.destroy) {
      await this.cache.destroy();
    } else if (this.cache.cleanup) {
      await this.cache.cleanup();
    }

    this.log.info('Manager destroyed');
  }

  /**
   * Helper methods
   */

  private isWatchJob(job: Job): boolean {
    return job.name === WATCH_JOB_NAME;
  }

  private validateJobData(data: CreateJob | UpdateJob, isUpdate: boolean = false): void {
    // Validate input data exists
    if (!data) {
      throw new Error(isUpdate ? 'Update data is required' : 'Job data is required');
    }

    // Validate name if provided
    if (data.name !== undefined) {
      if (typeof data.name !== 'string' || !data.name.trim()) {
        throw new Error('Job name must be a non-empty string');
      }
    } else if (!isUpdate) {
      // Name is required for creation
      throw new Error('Job name is required');
    }

    // Validate type if provided
    if (data.type !== undefined) {
      if (!['query', 'method', 'inline'].includes(data.type)) {
        throw new Error('Job type must be one of: query, method, inline');
      }
    } else if (!isUpdate) {
      // Type is required for creation
      throw new Error('Job type is required');
    }

    // Validate cron expression if provided
    if (data.cron) {
      if (typeof data.cron !== 'string') {
        throw new Error('Cron expression must be a string');
      }

      try {
        new CronJob(data.cron, () => {
          // No-op function for validation only
        });
      } catch {
        throw new Error(`Invalid cron expression: ${data.cron}`);
      }
    }

    // Validate query jobs have a query only if they're executable (enabled with cron)
    if (data.type === 'query' && data.enabled && data.cron && !data.query) {
      throw new Error('Query jobs must have a query string when enabled and scheduled');
    }

    // Validate that method jobs have a handler if they're scheduled and enabled
    if (data.type === 'method' && data.cron && data.enabled && !this.handler) {
      throw new Error(
        'Method jobs require a job handler to be registered when scheduled and enabled',
      );
    }
  }

  private ensureInitialized(): void {
    if (this.isDestroyed) {
      throw new Error('Manager has been destroyed.');
    }
    if (!this.isInitialized) {
      throw new Error('Manager not initialized. Call initialize() first.');
    }
  }

  /**
   * Update control with retry logic to handle version conflicts
   */
  private async updateControlWithRetry(
    id: string,
    data: UpdateControl,
    maxRetries: number = 3,
  ): Promise<Control> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const control = await this.storage.getControl();
        if (!control) {
          throw new Error('Control not found');
        }

        return await this.storage.updateControl(id, {
          ...data,
          version: control.version, // Use current version
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('version mismatch') &&
          attempt < maxRetries
        ) {
          // Version conflict - wait with exponential backoff before retry
          const delay = Math.pow(2, attempt) * 100; // 200ms, 400ms, 800ms
          this.log.debug(
            `Control version conflict, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }

    throw new Error(`Failed to update control after ${maxRetries} attempts`);
  }

  private async triggerReset(): Promise<void> {
    try {
      const control = await this.storage.getControl();
      if (control) {
        // Use the retry helper to handle version conflicts gracefully
        await this.updateControlWithRetry(control.id, {
          stale: control.replicas,
        });
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('version mismatch')) {
        // Version conflict - another replica updated it, which is fine
        this.log.debug('Control updated by another replica during reset trigger');
      } else {
        // Log but don't fail on version conflicts during reset
        this.log.warn(
          `Reset trigger failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private encryptQuery(text: string): string {
    if (!this.querySecret) {
      throw new Error('Query secret not configured');
    }
    return crypto.AES.encrypt(text, this.querySecret).toString();
  }

  private decryptQuery(text: string): string {
    if (!this.querySecret) {
      throw new Error('Query secret not configured');
    }
    const bytes = crypto.AES.decrypt(text, this.querySecret);
    return bytes.toString(crypto.enc.Utf8);
  }

  private serializeResult(result: any, lens: Lens): any {
    if (result instanceof Lens) {
      return result.getFrames();
    }

    if (!result && !lens.isEmpty) {
      return lens.getFrames();
    }

    // Return the result as-is, let the storage layer handle serialization
    // This prevents double stringification and allows proper JSON storage
    return result;
  }

  private readonly log = {
    error: (message: string) => this.logMessage('error', message),
    warn: (message: string) => this.logMessage('warn', message),
    info: (message: string) => this.logMessage('info', message),
    debug: (message: string) => this.logMessage('debug', message),
  };

  private logMessage(level: string, message: string): void {
    const currentLevel = this.logLevels[this.logLevel] ?? 2;
    const messageLevel = this.logLevels[level] ?? 2;

    if (messageLevel <= currentLevel) {
      switch (level) {
        case 'error':
          this.logger.error(message);
          break;
        case 'warn':
          this.logger.warn(message);
          break;
        case 'info':
          this.logger.log(message);
          break;
        case 'debug':
          this.logger.debug(message);
          break;
        default:
          this.logger.log(message);
          break;
      }
    }
  }

  // Track locks acquired by this manager instance for safe cleanup
  private readonly activeLocks = new Map<string, string>();
}
