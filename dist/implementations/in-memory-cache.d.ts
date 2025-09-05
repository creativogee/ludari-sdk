/**
 * In-memory cache implementation for Nest Cron Manager v3
 * Suitable for single-instance deployments and testing
 */
import { Cache, LockOptions, LockResult } from '../interfaces/cache.interface';
/**
 * In-memory cache implementation with TTL support
 * Thread-safe with automatic cleanup of expired items
 */
export declare class InMemoryCache implements Cache {
    private options;
    private locks;
    private contexts;
    private batches;
    private lockPromise;
    private cleanupInterval?;
    isDestroyed: boolean;
    constructor(options?: {
        /** Cleanup interval in milliseconds (default: 30 seconds) */
        cleanupIntervalMs?: number;
        /** Enable debug logging */
        debug?: boolean;
        /** Disable cleanup interval (useful for testing) */
        disableCleanup?: boolean;
    });
    /**
     * Execute operation with exclusive lock
     */
    private withLock;
    /**
     * Log debug message if debug mode is enabled
     */
    private debug;
    /**
     * Distributed locking operations
     */
    acquireLock(key: string, options: LockOptions): Promise<LockResult>;
    releaseLock(key: string, lockValue: string): Promise<boolean>;
    extendLock(key: string, lockValue: string, ttlMs: number): Promise<boolean>;
    /**
     * Context storage operations
     */
    setJobContext(jobName: string, context: Record<string, any>, ttlMs?: number): Promise<void>;
    getJobContext(jobName: string): Promise<Record<string, any> | null>;
    deleteJobContext(jobName: string): Promise<void>;
    /**
     * Batch counter operations
     */
    incrementBatch(jobName: string): Promise<number>;
    getBatch(jobName: string): Promise<number>;
    resetBatch(jobName: string): Promise<void>;
    /**
     * Health check and cleanup
     */
    isHealthy(): Promise<boolean>;
    cleanup(): Promise<void>;
    /**
     * Internal cleanup operation
     */
    private performCleanup;
    /**
     * Replica health management
     */
    pingReplica(replicaId: string): Promise<boolean>;
    /**
     * Destroy the cache and clean up resources
     */
    destroy(): Promise<void>;
    /**
     * Get cache statistics (useful for debugging)
     */
    getStats(): Promise<{
        locks: number;
        contexts: number;
        batches: number;
    }>;
}
