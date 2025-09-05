/**
 * Cache interface for Nest Cron Manager v3
 * Provides distributed locking, context storage, and batch operations
 */
/**
 * Lock acquisition options
 */
export interface LockOptions {
    /** Lock TTL in milliseconds */
    ttlMs: number;
    /** Optional lock value (will generate UUID if not provided) */
    value?: string;
}
/**
 * Lock acquisition result
 */
export interface LockResult {
    /** Whether the lock was successfully acquired */
    acquired: boolean;
    /** Lock value/token (only present if acquired=true) */
    lockValue?: string;
    /** When the lock expires (only present if acquired=true) */
    expiresAt?: Date;
}
/**
 * Cache interface for distributed locking and context storage
 * Implementations should be fault-tolerant and not throw on failures
 */
export interface Cache {
    /**
     * Distributed locking operations
     */
    /**
     * Attempt to acquire a distributed lock
     * @param key Lock key (should be unique across the system)
     * @param options Lock options including TTL and optional value
     * @returns Lock result with acquisition status and lock value
     * @note Should not throw on failure, return { acquired: false } instead
     */
    acquireLock(key: string, options: LockOptions): Promise<LockResult>;
    /**
     * Release a distributed lock
     * @param key Lock key
     * @param lockValue Lock value returned from acquireLock
     * @returns true if lock was released, false if lock was not found or not owned
     * @note Should not throw on failure, return false instead
     */
    releaseLock(key: string, lockValue: string): Promise<boolean>;
    /**
     * Extend the TTL of an existing lock
     * @param key Lock key
     * @param lockValue Lock value returned from acquireLock
     * @param ttlMs New TTL in milliseconds
     * @returns true if lock was extended, false if lock was not found or not owned
     * @note Should not throw on failure, return false instead
     */
    extendLock(key: string, lockValue: string, ttlMs: number): Promise<boolean>;
    /**
     * Context storage operations - for dynamic job configuration
     */
    /**
     * Store job context data (automatically handles serialization)
     * @param jobName Job name (used as key prefix)
     * @param context Context data to store (will be serialized as single JSON)
     * @param ttlMs Optional TTL in milliseconds (no expiry if not provided)
     * @note Should not throw on failure, log errors internally
     * @note Handles proper JSON serialization - no double stringify
     */
    setJobContext(jobName: string, context: Record<string, any>, ttlMs?: number): Promise<void>;
    /**
     * Retrieve job context data (automatically handles deserialization)
     * @param jobName Job name
     * @returns Context data or null if not found/expired
     * @note Should not throw on failure, return null instead
     * @note Handles proper JSON deserialization - returns parsed object
     */
    getJobContext(jobName: string): Promise<Record<string, any> | null>;
    /**
     * Delete job context data
     * @param jobName Job name
     * @note Should not throw on failure, log errors internally
     */
    deleteJobContext(jobName: string): Promise<void>;
    /**
     * Batch counter operations - for concurrent job execution
     */
    /**
     * Increment batch counter for a job
     * @param jobName Job name
     * @returns New counter value
     * @note Should not throw on failure, return 1 as fallback
     */
    incrementBatch(jobName: string): Promise<number>;
    /**
     * Get current batch counter value
     * @param jobName Job name
     * @returns Current counter value (0 if not found)
     * @note Should not throw on failure, return 0 instead
     */
    getBatch(jobName: string): Promise<number>;
    /**
     * Reset batch counter for a job
     * @param jobName Job name
     * @note Should not throw on failure, log errors internally
     */
    resetBatch(jobName: string): Promise<void>;
    /**
     * Health check and cleanup
     */
    /**
     * Check if cache is healthy and responsive
     * @returns true if cache is working, false otherwise
     * @note Should not throw, return false on any error
     */
    isHealthy(): Promise<boolean>;
    /**
     * Clean up expired locks and data (optional)
     * Called periodically by the cron manager
     * @note Should not throw, log errors internally
     */
    cleanup?(): Promise<void>;
    /**
     * Destroy the cache and clean up all resources including intervals (optional)
     * Called when manager is being destroyed to ensure proper cleanup
     * @note Should not throw, log errors internally
     */
    destroy?(): Promise<void>;
    /**
     * Replica health management (optional)
     * If not implemented, replica cleanup will be skipped
     */
    /**
     * Check if a replica is healthy/responsive (optional)
     * @param replicaId Replica identifier to check
     * @returns true if replica responded within timeout, false otherwise
     * @note Should not throw, return false on any error
     * @note If not implemented, replica cleanup during initialization is disabled
     */
    pingReplica?(replicaId: string): Promise<boolean>;
}
