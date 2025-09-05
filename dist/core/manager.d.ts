import { Cache } from '../interfaces/cache.interface';
import { Handler } from '../interfaces/job-handler.interface';
import { Storage } from '../interfaces/storage.interface';
import { Control, CreateJob, Job, JobExecution, JobFilter, JobRun, JobRunFilter, PaginatedResponse, UpdateJob } from '../types/core';
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
export declare class Manager {
    private readonly replicaId;
    private readonly storage;
    private readonly cache;
    private readonly logger;
    private readonly handler?;
    private readonly querySecret?;
    private readonly enabled;
    private readonly watchInterval;
    private readonly releaseLocksOnShutdown;
    private readonly cronJobs;
    private logLevel;
    private readonly logLevels;
    private isInitialized;
    private isDestroyed;
    private isResetting;
    private readonly inlineHandlers;
    static readonly JobType: {
        INLINE: "inline";
        QUERY: "query";
        METHOD: "method";
    };
    constructor(options: ManagerOptions);
    /**
     * Register an inline job handler function by job name
     */
    register(name: string, handler: JobExecution): void;
    /**
     * Unregister a previously registered inline job handler
     */
    unregister(name: string): void;
    /**
     * Validate configuration based on intended usage
     */
    private validateConfiguration;
    /**
     * Validate query secret meets security requirements
     */
    private validateQuerySecret;
    /**
     * Validate replica ID format and security
     */
    private validateReplicaId;
    /**
     * Validate job access to prevent unauthorized operations on system jobs
     */
    private validateJobAccess;
    /**
     * Initialize the manager (call this after construction)
     */
    initialize(): Promise<void>;
    /**
     * Prepare the manager state and schedule jobs
     */
    private prepare;
    /**
     * Initialize and schedule all enabled jobs
     */
    private initializeJobs;
    /**
     * Schedule a single job
     */
    private scheduleJob;
    /**
     * Execute a scheduled job
     */
    private executeJob;
    /**
     * Reset jobs across all replicas
     */
    private resetJobs;
    /**
     * Handle job execution with distributed locking
     */
    handleJob(name: string, execution: JobExecution): Promise<void>;
    /**
     * Create a new job
     */
    createJob(data: CreateJob): Promise<Job>;
    /**
     * Update job configuration
     */
    updateJob(id: string, data: UpdateJob): Promise<Job>;
    /**
     * Toggle job enabled/disabled state
     */
    toggleJob(id: string): Promise<Job>;
    /**
     * Enable job configuration
     */
    enableJob(id: string): Promise<Job>;
    /**
     * Disable job configuration
     */
    disableJob(id: string): Promise<Job>;
    /**
     * Get job configuration by ID
     */
    getJob(id: string): Promise<Job | null>;
    /**
     * Delete job configuration
     */
    deleteJob(id: string): Promise<void>;
    /**
     * List job execution history
     */
    listJobRuns(filter?: JobRunFilter): Promise<PaginatedResponse<JobRun>>;
    listJobs(filter?: JobFilter): Promise<PaginatedResponse<Job>>;
    /**
     * Get control information
     */
    getControl(): Promise<Control | null>;
    /**
     * Toggle global control
     */
    toggleControl(): Promise<{
        enabled: boolean;
    }>;
    /**
     * Destroy the manager and clean up resources
     */
    destroy(): Promise<void>;
    /**
     * Helper methods
     */
    private isWatchJob;
    private validateJobData;
    private ensureInitialized;
    /**
     * Update control with retry logic to handle version conflicts
     */
    private updateControlWithRetry;
    private triggerReset;
    private encryptQuery;
    private decryptQuery;
    private validateAndSanitizeQuery;
    private serializeResult;
    private readonly log;
    private logMessage;
    /**
     * Start deadlock detection mechanism
     */
    private startDeadlockDetection;
    /**
     * Detect and handle potential deadlocks
     */
    private detectAndHandleDeadlocks;
    private readonly activeLocks;
    private deadlockDetectionInterval?;
}
