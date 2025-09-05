"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Manager = void 0;
/* istanbul ignore file */
const cron_1 = require("cron");
const crypto_1 = require("crypto");
const in_memory_cache_1 = require("../implementations/in-memory-cache");
const lens_1 = require("./lens");
const WATCH_JOB_NAME = '__watch__';
/**
 * Main manager class for handling cron jobs
 */
class Manager {
    constructor(options) {
        this.cronJobs = new Map();
        this.logLevel = 'info';
        this.logLevels = {
            error: 0,
            warn: 1,
            info: 2,
            debug: 3,
        };
        this.isInitialized = false;
        this.isDestroyed = false;
        this.isResetting = false;
        // Registered inline job handlers by job name
        this.inlineHandlers = new Map();
        this.log = {
            error: (message) => this.logMessage('error', message),
            warn: (message) => this.logMessage('warn', message),
            info: (message) => this.logMessage('info', message),
            debug: (message) => this.logMessage('debug', message),
        };
        // Track locks acquired by this manager instance for safe cleanup
        this.activeLocks = new Map();
        this.replicaId = options.replicaId || process.env.LUDARI_REPLICA_ID || (0, crypto_1.randomUUID)();
        this.storage = options.storage;
        this.cache = options.cache ?? new in_memory_cache_1.InMemoryCache();
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
    register(name, handler) {
        if (!name || typeof handler !== 'function') {
            throw new Error('Inline handler requires a valid name and function');
        }
        this.inlineHandlers.set(name, handler);
    }
    /**
     * Unregister a previously registered inline job handler
     */
    unregister(name) {
        this.inlineHandlers.delete(name);
    }
    /**
     * Validate configuration based on intended usage
     */
    validateConfiguration() {
        if (!this.storage) {
            throw new Error('storage implementation is required');
        }
        if (!this.logger) {
            throw new Error('logger is required');
        }
        // Validate query secret strength if provided
        if (this.querySecret) {
            this.validateQuerySecret(this.querySecret);
        }
        // Validate replica ID
        this.validateReplicaId(this.replicaId);
    }
    /**
     * Validate query secret meets security requirements
     */
    validateQuerySecret(secret) {
        if (typeof secret !== 'string') {
            throw new Error('Query secret must be a string');
        }
        if (secret.length < 32) {
            throw new Error('Query secret must be at least 32 characters long for adequate security');
        }
        // Check for minimum complexity
        const hasLowerCase = /[a-z]/.test(secret);
        const hasUpperCase = /[A-Z]/.test(secret);
        const hasNumbers = /\d/.test(secret);
        const hasSpecialChars = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(secret);
        const complexityScore = [hasLowerCase, hasUpperCase, hasNumbers, hasSpecialChars].filter(Boolean).length;
        if (complexityScore < 3) {
            throw new Error('Query secret must contain at least 3 of: lowercase, uppercase, numbers, special characters');
        }
        // Check for common weak patterns
        const weakPatterns = [
            /(.)\1{3,}/, // Repeated characters (aaaa, 1111, etc.)
            /123456/, // Sequential numbers
            /abcdef/i, // Sequential letters
            /password/i, // Common words
            /secret/i,
            /admin/i,
            /qwerty/i,
        ];
        for (const pattern of weakPatterns) {
            if (pattern.test(secret)) {
                throw new Error('Query secret contains weak patterns. Please use a stronger secret.');
            }
        }
        this.log.debug('Query secret validation passed');
    }
    /**
     * Validate replica ID format and security
     */
    validateReplicaId(replicaId) {
        if (typeof replicaId !== 'string') {
            throw new Error('Replica ID must be a string');
        }
        if (replicaId.length < 8) {
            throw new Error('Replica ID must be at least 8 characters long');
        }
        // Check for UUID format (preferred) or other secure formats
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const securePattern = /^[a-zA-Z0-9_-]{8,}$/; // Alphanumeric with hyphens/underscores
        if (!uuidPattern.test(replicaId) && !securePattern.test(replicaId)) {
            throw new Error('Replica ID must be a UUID or contain only alphanumeric characters, hyphens, and underscores');
        }
        // Warn about using environment variable defaults in production
        if (replicaId === process.env.LUDARI_REPLICA_ID && process.env.NODE_ENV === 'production') {
            this.log.warn('Using environment variable LUDARI_REPLICA_ID in production. Ensure it is properly secured.');
        }
        this.log.debug(`Replica ID validation passed: ${replicaId}`);
    }
    /**
     * Validate job access to prevent unauthorized operations on system jobs
     */
    validateJobAccess(jobName, operation) {
        if (!jobName || typeof jobName !== 'string') {
            throw new Error('Job name must be a non-empty string');
        }
        // System jobs are protected and cannot be modified directly
        const systemJobs = [WATCH_JOB_NAME];
        const protectedPrefixes = ['__', 'system:', 'internal:'];
        if (systemJobs.includes(jobName)) {
            throw new Error(`Cannot ${operation} system job: ${jobName}`);
        }
        // Check for protected prefixes
        for (const prefix of protectedPrefixes) {
            if (jobName.startsWith(prefix)) {
                throw new Error(`Cannot ${operation} job with protected prefix '${prefix}': ${jobName}`);
            }
        }
        // Validate job name format for security
        if (!/^[a-zA-Z0-9_-]+$/.test(jobName)) {
            throw new Error(`Job name '${jobName}' contains invalid characters. Only alphanumeric, hyphens, and underscores are allowed.`);
        }
        if (jobName.length > 100) {
            throw new Error('Job name cannot exceed 100 characters');
        }
    }
    /**
     * Initialize the manager (call this after construction)
     */
    async initialize() {
        if (this.isInitialized) {
            return;
        }
        try {
            // No automatic replica registration - only cleanup on initialization
            await this.prepare();
            // Start deadlock detection mechanism
            this.startDeadlockDetection();
            this.isInitialized = true;
            this.log.info(`Manager initialized with replicaId: ${this.replicaId}`);
        }
        catch (error) {
            this.log.error(`Initialization failed: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    /**
     * Prepare the manager state and schedule jobs
     */
    async prepare() {
        try {
            // Get or create control record
            let control = await this.storage.getControl();
            if (!control) {
                control = await this.storage.createControl({
                    enabled: true,
                    replicas: [this.replicaId],
                    stale: [],
                    version: (0, crypto_1.randomUUID)(),
                });
            }
            // Health check existing replicas and remove inactive ones
            const healthyReplicas = await this.performReplicaHealthCheck(control.replicas);
            // Register this replica if not already included
            if (!healthyReplicas.includes(this.replicaId)) {
                healthyReplicas.push(this.replicaId);
            }
            // Update control with cleaned replica list if it changed
            const arraysEqual = (arr1, arr2) => arr1.length === arr2.length &&
                arr1.every((item) => arr2.includes(item)) &&
                arr2.every((item) => arr1.includes(item));
            if (!arraysEqual(healthyReplicas, control.replicas)) {
                const removedReplicas = control.replicas.filter((r) => !healthyReplicas.includes(r));
                if (removedReplicas.length > 0) {
                    this.log.info(`Removed ${removedReplicas.length} inactive replicas`);
                }
                // Use retry logic to handle concurrent updates
                // Mark this as a health check operation to use exact replacement logic
                await this.updateControlWithRetry(control.id, {
                    replicas: healthyReplicas,
                    stale: control.stale.filter((r) => healthyReplicas.includes(r)), // Remove stale entries for inactive replicas
                    _isHealthCheckUpdate: true, // Special flag to indicate this should replace, not merge
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
        }
        catch (error) {
            this.log.warn(`Prepare failed: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    /**
     * Initialize and schedule all enabled jobs
     */
    async initializeJobs() {
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
        }
        catch (error) {
            this.log.warn(`Job initialization failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Schedule a single job
     */
    async scheduleJob(job) {
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
            const cronJob = new cron_1.CronJob(job.cron, () => {
                this.executeJob(job).catch((error) => {
                    this.log.error(`Job execution failed: ${job.name} - ${error instanceof Error ? error.message : String(error)}`);
                });
            });
            cronJob.start();
            this.cronJobs.set(job.name, cronJob);
            if (job.name !== WATCH_JOB_NAME) {
                this.log.info(`Scheduled job: ${job.name} (${job.cron})`);
            }
        }
        catch (error) {
            this.log.warn(`Failed to schedule job ${job.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Execute a scheduled job
     */
    async executeJob(job) {
        try {
            // Update log level from control
            const control = await this.storage.getControl();
            this.logLevel = control?.log_level || 'info';
            // Handle replica synchronization
            if (control && control.stale.length > 0) {
                await this.resetJobs(control);
            }
            // Handle watch job execution - no replica registration renewal
            if (job.name === WATCH_JOB_NAME) {
                return;
            }
            let execution;
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
                        const decryptedQuery = this.decryptQuery(job.query);
                        const validatedQuery = this.validateAndSanitizeQuery(decryptedQuery);
                        return await this.storage.executeQuery(validatedQuery);
                    };
                    break;
                case 'method':
                    execution = async (context, lens) => {
                        if (!this.handler) {
                            this.log.warn(`No job handler registered for method jobs`);
                            return;
                        }
                        return await this.handler.executeMethod(job.name, context || {}, lens || new lens_1.Lens());
                    };
                    break;
                case 'inline':
                    execution = async (context, lens) => {
                        const handler = this.inlineHandlers.get(job.name);
                        if (!handler) {
                            this.log.warn(`No inline handler registered for job: ${job.name}`);
                            return;
                        }
                        return handler(context || {}, lens || new lens_1.Lens());
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
        }
        catch (error) {
            this.log.warn(`Failed to execute job ${job.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Reset jobs across all replicas
     */
    async resetJobs(control) {
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
        }
        catch (error) {
            if (error instanceof Error && error.message.includes('version mismatch')) {
                // Version conflict - another replica updated it, which is fine
                this.log.debug('Control updated by another replica during job reset');
            }
            else {
                this.log.warn(`Reset jobs failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        finally {
            this.isResetting = false;
        }
    }
    /**
     * Handle job execution with distributed locking
     */
    async handleJob(name, execution) {
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
        const lens = new lens_1.Lens();
        let jobRun = null;
        let lockValue;
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
            let context = job.context || {};
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
                // Track active lock for cleanup on shutdown with metadata
                if (lockValue) {
                    this.activeLocks.set(lockKey, {
                        lockValue,
                        acquiredAt: new Date(),
                        ttlMs: ttl,
                        jobName: name,
                    });
                }
                if (!job.silent) {
                    this.log.info(`Job started: ${name}`);
                }
            }
            else {
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
        }
        catch (error) {
            const errorObj = error instanceof Error ? error : new Error(String(error));
            lens.captureError(errorObj, 'Job execution failed');
            if (jobRun) {
                await this.storage.updateJobRun(jobRun.id, {
                    failed: new Date(),
                    result: lens.getFrames(),
                });
            }
            this.log.warn(`Job failed: ${name} - ${errorObj.message}`);
        }
        finally {
            // Release lock with error handling
            if (lockValue) {
                try {
                    await this.cache.releaseLock(lockKey, lockValue);
                    this.activeLocks.delete(lockKey);
                    this.log.debug(`Lock released successfully: ${lockKey}`);
                }
                catch (releaseError) {
                    this.log.warn(`Failed to release lock ${lockKey}: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`);
                    // Still remove from tracking to prevent accumulation
                    this.activeLocks.delete(lockKey);
                }
            }
        }
    }
    /**
     * Create a new job
     */
    async createJob(data) {
        this.ensureInitialized();
        this.validateJobData(data);
        // Prevent creation of system jobs
        this.validateJobAccess(data.name, 'create');
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
    async updateJob(id, data) {
        this.ensureInitialized();
        const existingJob = await this.storage.findJob(id);
        this.validateJobData(data, true);
        if (existingJob) {
            this.validateJobAccess(existingJob.name, 'update');
        }
        if (data.name) {
            this.validateJobAccess(data.name, 'update');
        }
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
    async toggleJob(id) {
        this.ensureInitialized();
        if (!id) {
            throw new Error('Job id is required');
        }
        const job = await this.storage.findJob(id);
        if (!job) {
            throw new Error(`Job not found: ${id}`);
        }
        this.validateJobAccess(job.name, 'toggle');
        return this.updateJob(job.id, { enabled: !job.enabled });
    }
    /**
     * Enable job configuration
     */
    async enableJob(id) {
        this.ensureInitialized();
        if (!id) {
            throw new Error('Job ID is required');
        }
        const job = await this.storage.findJob(id);
        if (!job) {
            throw new Error(`Job not found: ${id}`);
        }
        this.validateJobAccess(job.name, 'enable');
        if (job.enabled) {
            return job; // Already enabled, return as-is
        }
        return this.updateJob(id, { enabled: true });
    }
    /**
     * Disable job configuration
     */
    async disableJob(id) {
        this.ensureInitialized();
        if (!id) {
            throw new Error('Job ID is required');
        }
        const job = await this.storage.findJob(id);
        if (!job) {
            throw new Error(`Job not found: ${id}`);
        }
        this.validateJobAccess(job.name, 'disable');
        if (!job.enabled) {
            return job; // Already disabled, return as-is
        }
        return this.updateJob(id, { enabled: false });
    }
    /**
     * Get job configuration by ID
     */
    async getJob(id) {
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
    async deleteJob(id) {
        this.ensureInitialized();
        if (!id) {
            throw new Error('Job ID is required');
        }
        const job = await this.storage.findJob(id);
        if (!job) {
            throw new Error(`Job not found: ${id}`);
        }
        this.validateJobAccess(job.name, 'delete');
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
    async listJobRuns(filter) {
        this.ensureInitialized();
        const jobRunsResponse = await this.storage.findJobRuns(filter);
        return jobRunsResponse;
    }
    // Add listJobs method that lists job definitions (not execution history)
    async listJobs(filter) {
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
    async getControl() {
        this.ensureInitialized();
        return this.storage.getControl();
    }
    /**
     * Toggle global control
     */
    async toggleControl() {
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
     * Purge the control - clear all replicas and stale entries
     * This will clear all replicas and stale entries, effectively starting fresh
     */
    async purgeControl() {
        this.ensureInitialized();
        const control = await this.storage.getControl();
        if (!control) {
            throw new Error('Control not found');
        }
        // Reset both replicas and stale lists to empty arrays
        const updatedControl = await this.updateControlWithRetry(control.id, {
            replicas: [],
            stale: [],
        });
        // Reinitialize the manager state after purging
        await this.prepare();
        this.log.info('Replica list reset - all replicas and stale entries cleared');
        return {
            success: true,
            replicas: updatedControl.replicas,
            stale: updatedControl.stale,
        };
    }
    /**
     * Destroy the manager and clean up resources
     */
    async destroy() {
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
        // Stop deadlock detection
        if (this.deadlockDetectionInterval) {
            clearInterval(this.deadlockDetectionInterval);
            this.deadlockDetectionInterval = undefined;
        }
        // Release locks if configured
        if (this.releaseLocksOnShutdown) {
            const lockCount = this.activeLocks.size;
            this.log.info(`Releasing ${lockCount} active locks on shutdown`);
            for (const [key, lockInfo] of this.activeLocks.entries()) {
                try {
                    await this.cache.releaseLock(key, lockInfo.lockValue);
                    this.log.debug(`Released lock '${key}' for job '${lockInfo.jobName}'`);
                }
                catch (err) {
                    this.log.warn(`Failed to release lock '${key}' on shutdown: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
            this.activeLocks.clear();
            this.log.info('All locks released on shutdown');
        }
        // Clear inline handlers to avoid retaining references after shutdown
        this.inlineHandlers.clear();
        // Destroy cache if it supports it (proper cleanup with interval clearing)
        if (this.cache.destroy) {
            await this.cache.destroy();
        }
        else if (this.cache.cleanup) {
            await this.cache.cleanup();
        }
        this.log.info('Manager destroyed');
    }
    /**
     * Helper methods
     */
    isWatchJob(job) {
        return job.name === WATCH_JOB_NAME;
    }
    validateJobData(data, isUpdate = false) {
        // Validate input data exists
        if (!data) {
            throw new Error(isUpdate ? 'Update data is required' : 'Job data is required');
        }
        // Validate name if provided
        if (data.name !== undefined) {
            if (typeof data.name !== 'string' || !data.name.trim()) {
                throw new Error('Job name must be a non-empty string');
            }
        }
        else if (!isUpdate) {
            // Name is required for creation
            throw new Error('Job name is required');
        }
        // Validate type if provided
        if (data.type !== undefined) {
            if (!['query', 'method', 'inline'].includes(data.type)) {
                throw new Error('Job type must be one of: query, method, inline');
            }
        }
        else if (!isUpdate) {
            // Type is required for creation
            throw new Error('Job type is required');
        }
        // Validate cron expression if provided
        if (data.cron) {
            if (typeof data.cron !== 'string') {
                throw new Error('Cron expression must be a string');
            }
            try {
                new cron_1.CronJob(data.cron, () => {
                    // No-op function for validation only
                });
            }
            catch (cronError) {
                this.log.warn(`Cron validation failed for '${data.cron}': ${cronError instanceof Error ? cronError.message : String(cronError)}`);
                throw new Error(`Invalid cron expression: ${data.cron}`);
            }
        }
        // Validate query jobs have a query only if they're executable (enabled with cron)
        if (data.type === 'query' && data.enabled && data.cron && !data.query) {
            throw new Error('Query jobs must have a query string when enabled and scheduled');
        }
        // Validate that method jobs have a handler if they're scheduled and enabled
        if (data.type === 'method' && data.cron && data.enabled && !this.handler) {
            throw new Error('Method jobs require a job handler to be registered when scheduled and enabled');
        }
    }
    ensureInitialized() {
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
    async updateControlWithRetry(id, data, maxRetries = 5) {
        let lastError = null;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                // Get fresh control data for each attempt
                const currentControl = await this.storage.getControl();
                if (!currentControl) {
                    throw new Error('Control not found');
                }
                // Validate that we're updating the correct control record
                if (currentControl.id !== id) {
                    throw new Error(`Control ID mismatch: expected ${id}, got ${currentControl.id}`);
                }
                // Merge data with current control state to handle concurrent updates
                const mergedData = {
                    ...data,
                    version: currentControl.version, // Use current version for optimistic locking
                };
                // Special handling for array operations to prevent race conditions
                if (data.replicas !== undefined) {
                    // For purgeControl (empty array) or health check updates, use exact replacement
                    if (data.replicas.length === 0 || data._isHealthCheckUpdate) {
                        mergedData.replicas = data.replicas;
                    }
                    else {
                        // For replica additions, merge with current state to avoid losing
                        // replicas that were added concurrently by other instances
                        const currentReplicas = new Set(currentControl.replicas);
                        const newReplicas = new Set(data.replicas);
                        mergedData.replicas = Array.from(new Set([...currentReplicas, ...newReplicas]));
                    }
                }
                if (data.stale !== undefined) {
                    // For stale list, use exact replacement but validate against current state
                    mergedData.stale = data.stale;
                }
                return await this.storage.updateControl(id, mergedData);
            }
            catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                if (lastError.message.includes('version mismatch') ||
                    lastError.message.includes('optimistic lock') ||
                    lastError.message.includes('concurrent modification')) {
                    if (attempt < maxRetries) {
                        // Exponential backoff with jitter to reduce thundering herd
                        const baseDelay = Math.pow(2, attempt) * 100; // 200ms, 400ms, 800ms, 1600ms, 3200ms
                        const jitter = Math.random() * 0.1 * baseDelay; // Add up to 10% jitter
                        const delay = Math.floor(baseDelay + jitter);
                        this.log.debug(`Control update conflict on attempt ${attempt}/${maxRetries}, retrying in ${delay}ms: ${lastError.message}`);
                        await new Promise((resolve) => setTimeout(resolve, delay));
                        continue;
                    }
                }
                // For non-retryable errors, throw immediately
                if (!lastError.message.includes('version mismatch') &&
                    !lastError.message.includes('optimistic lock') &&
                    !lastError.message.includes('concurrent modification')) {
                    throw lastError;
                }
            }
        }
        throw new Error(`Failed to update control after ${maxRetries} attempts. Last error: ${lastError?.message || 'Unknown error'}`);
    }
    async triggerReset() {
        try {
            const control = await this.storage.getControl();
            if (!control) {
                this.log.warn('Control not found during reset trigger');
                return;
            }
            // Create atomic update that marks all current replicas as stale
            await this.updateControlWithRetry(control.id, {
                stale: [...control.replicas], // Make a copy to avoid reference issues
                version: (0, crypto_1.randomUUID)(), // Force new version
            });
            this.log.debug(`Reset triggered for ${control.replicas.length} replicas`);
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('version mismatch') ||
                errorMessage.includes('optimistic lock') ||
                errorMessage.includes('concurrent modification')) {
                // Concurrent modification is acceptable during reset - another replica may have triggered it
                this.log.debug('Control updated by another replica during reset trigger');
            }
            else {
                // Log but don't fail on other errors to maintain system stability
                this.log.warn(`Reset trigger failed: ${errorMessage}`);
            }
        }
    }
    encryptQuery(text) {
        if (!this.querySecret) {
            throw new Error('Query secret not configured');
        }
        // Generate a random IV for each encryption
        const iv = (0, crypto_1.randomBytes)(16);
        // Derive key using PBKDF2
        const salt = (0, crypto_1.randomBytes)(32);
        const key = (0, crypto_1.pbkdf2Sync)(this.querySecret, salt, 100000, 32, 'sha256');
        // Use AES-256-CTR for compatibility
        const cipher = (0, crypto_1.createCipheriv)('aes-256-ctr', key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        // Combine IV, salt, and encrypted data
        const combined = Buffer.concat([iv, salt, Buffer.from(encrypted, 'hex')]);
        return combined.toString('base64');
    }
    decryptQuery(encryptedData) {
        if (!this.querySecret) {
            throw new Error('Query secret not configured');
        }
        try {
            const combined = Buffer.from(encryptedData, 'base64');
            // Extract components
            const iv = combined.subarray(0, 16);
            const salt = combined.subarray(16, 48);
            const encrypted = combined.subarray(48);
            // Derive key using PBKDF2
            const key = (0, crypto_1.pbkdf2Sync)(this.querySecret, salt, 100000, 32, 'sha256');
            // Use AES-256-CTR for compatibility
            const decipher = (0, crypto_1.createDecipheriv)('aes-256-ctr', key, iv);
            let decrypted = decipher.update(encrypted, undefined, 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        }
        catch (error) {
            throw new Error(`Failed to decrypt query: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    validateAndSanitizeQuery(query) {
        if (!query || typeof query !== 'string') {
            throw new Error('Query must be a non-empty string');
        }
        // Remove comments and normalize whitespace
        const sanitized = query
            .replace(/--.*$/gm, '') // Remove SQL comments
            .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
        if (!sanitized) {
            throw new Error('Query cannot be empty after sanitization');
        }
        // Define allowed SQL operations for job queries
        const allowedOperations = [
            'SELECT',
            'INSERT',
            'UPDATE',
            'DELETE',
            'WITH',
            'CALL',
            'EXEC',
            'EXECUTE',
        ];
        // Check if query starts with allowed operation
        const firstToken = sanitized.toUpperCase().split(/\s+/)[0];
        if (!allowedOperations.includes(firstToken)) {
            throw new Error(`SQL operation '${firstToken}' is not allowed. Allowed operations: ${allowedOperations.join(', ')}`);
        }
        // Prevent dangerous SQL patterns
        const dangerousPatterns = [
            /;\s*(DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\s+/i,
            /UNION.*SELECT/i,
            /;\s*--/,
            /'\s*;\s*/,
            /\b(xp_|sp_)/i, // SQL Server extended procedures
            /INFORMATION_SCHEMA/i,
            /pg_/i, // PostgreSQL system tables
            /mysql\./i, // MySQL system database
        ];
        for (const pattern of dangerousPatterns) {
            if (pattern.test(sanitized)) {
                throw new Error(`Query contains potentially dangerous pattern: ${pattern.toString()}`);
            }
        }
        // Validate query length to prevent extremely large queries
        if (sanitized.length > 10000) {
            throw new Error('Query exceeds maximum allowed length of 10000 characters');
        }
        // Log query execution for audit purposes
        this.log.debug(`Executing validated query: ${sanitized.substring(0, 100)}${sanitized.length > 100 ? '...' : ''}`);
        return sanitized;
    }
    serializeResult(result, lens) {
        if (result instanceof lens_1.Lens) {
            return result.getFrames();
        }
        if (!result && !lens.isEmpty) {
            return lens.getFrames();
        }
        // Return the result as-is, let the storage layer handle serialization
        // This prevents double stringification and allows proper JSON storage
        return result;
    }
    logMessage(level, message) {
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
    /**
     * Start deadlock detection mechanism
     */
    startDeadlockDetection() {
        // Run deadlock detection every 60 seconds
        this.deadlockDetectionInterval = setInterval(() => {
            this.detectAndHandleDeadlocks().catch((error) => {
                this.log.warn(`Deadlock detection failed: ${error instanceof Error ? error.message : String(error)}`);
            });
        }, 60000);
        // Do not keep the process alive for background detection
        if (typeof this.deadlockDetectionInterval.unref === 'function') {
            this.deadlockDetectionInterval.unref();
        }
    }
    /**
     * Detect and handle potential deadlocks
     */
    async detectAndHandleDeadlocks() {
        if (this.isDestroyed || this.activeLocks.size === 0) {
            return;
        }
        const now = new Date();
        const staleLocks = [];
        // Check for locks that have exceeded their TTL by a significant margin
        for (const [lockKey, lockInfo] of this.activeLocks.entries()) {
            const lockAge = now.getTime() - lockInfo.acquiredAt.getTime();
            const stalenessThreshold = lockInfo.ttlMs * 2; // Consider stale if 2x TTL has passed
            if (lockAge > stalenessThreshold) {
                staleLocks.push(lockKey);
                this.log.warn(`Detected potentially stale lock: ${lockKey} for job '${lockInfo.jobName}' ` +
                    `(age: ${Math.round(lockAge / 1000)}s, TTL: ${Math.round(lockInfo.ttlMs / 1000)}s)`);
            }
        }
        // Attempt to clean up stale locks
        for (const lockKey of staleLocks) {
            const lockInfo = this.activeLocks.get(lockKey);
            if (lockInfo) {
                try {
                    // Try to release the stale lock
                    const released = await this.cache.releaseLock(lockKey, lockInfo.lockValue);
                    if (released) {
                        this.activeLocks.delete(lockKey);
                        this.log.info(`Successfully cleaned up stale lock: ${lockKey}`);
                    }
                    else {
                        this.log.warn(`Failed to release stale lock (may already be expired): ${lockKey}`);
                        // Remove from tracking anyway since we can't release it
                        this.activeLocks.delete(lockKey);
                    }
                }
                catch (error) {
                    this.log.warn(`Error cleaning up stale lock ${lockKey}: ${error instanceof Error ? error.message : String(error)}`);
                    // Remove from tracking to prevent repeated attempts
                    this.activeLocks.delete(lockKey);
                }
            }
        }
        // Log active locks summary for monitoring
        if (this.activeLocks.size > 0) {
            const lockSummary = Array.from(this.activeLocks.entries())
                .map(([, info]) => {
                const age = Math.round((now.getTime() - info.acquiredAt.getTime()) / 1000);
                return `${info.jobName}:${age}s`;
            })
                .join(', ');
            this.log.debug(`Active locks (${this.activeLocks.size}): ${lockSummary}`);
        }
    }
    /**
     * Perform health check on existing replicas during initialization and return list of healthy ones
     * Only runs during manager initialization to clean up definitively inactive replicas
     */
    async performReplicaHealthCheck(replicas) {
        if (!replicas.length) {
            return [];
        }
        // If cache doesn't support replica health checks, keep all replicas + current one
        if (!this.cache.pingReplica) {
            this.log.debug('Cache does not support replica health checks, keeping all replicas');
            const allReplicas = [...replicas];
            if (!allReplicas.includes(this.replicaId)) {
                allReplicas.push(this.replicaId);
            }
            return allReplicas;
        }
        const healthyReplicas = [];
        // Always include current replica
        healthyReplicas.push(this.replicaId);
        // Check health of other replicas
        const otherReplicas = replicas.filter(r => r !== this.replicaId);
        if (otherReplicas.length === 0) {
            this.log.debug('No other replicas to health check');
            return healthyReplicas;
        }
        this.log.debug(`Performing health check on ${otherReplicas.length} existing replicas during initialization`);
        // Check each other replica's health with timeout
        const healthCheckPromises = otherReplicas.map(async (replicaId) => {
            try {
                const isHealthy = await Promise.race([
                    this.cache.pingReplica(replicaId),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Health check timeout')), 5000))
                ]);
                return { replicaId, isHealthy };
            }
            catch (error) {
                this.log.debug(`Health check failed for replica ${replicaId}: ${error instanceof Error ? error.message : String(error)}`);
                return { replicaId, isHealthy: false };
            }
        });
        const healthCheckResults = await Promise.all(healthCheckPromises);
        // Only keep replicas that are definitively healthy
        for (const result of healthCheckResults) {
            if (result.isHealthy) {
                healthyReplicas.push(result.replicaId);
                this.log.debug(`Replica ${result.replicaId} is healthy, keeping it`);
            }
            else {
                this.log.debug(`Replica ${result.replicaId} appears inactive, removing from list`);
            }
        }
        const removedCount = replicas.length - healthyReplicas.length + 1; // +1 because we always add current
        if (removedCount > 0) {
            this.log.info(`Cleaned up ${removedCount} inactive replicas during initialization`);
        }
        return healthyReplicas;
    }
}
exports.Manager = Manager;
Manager.JobType = {
    INLINE: 'inline',
    QUERY: 'query',
    METHOD: 'method',
};
