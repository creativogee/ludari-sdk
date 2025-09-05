/**
 * Redis cache implementation for Nest Cron Manager v3
 * Production-ready distributed cache with proper lock management
 */
import { Cache, LockOptions, LockResult } from '../interfaces/cache.interface';
/**
 * Redis client interface - compatible with ioredis and node-redis
 */
export interface RedisClient {
    set(key: string, value: string, mode?: string, duration?: number, flag?: string): Promise<string | null>;
    get(key: string): Promise<string | null>;
    del(key: string): Promise<number>;
    incr(key: string): Promise<number>;
    eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<any>;
    exists(key: string): Promise<number>;
    ttl(key: string): Promise<number>;
    pexpire(key: string, ttlMs: number): Promise<number>;
}
/**
 * Redis cache implementation with distributed locking
 */
export declare class RedisCache implements Cache {
    private redis;
    private options;
    private keyPrefix;
    private releaseLockScript;
    private extendLockScript;
    constructor(redis: RedisClient, options?: {
        /** Key prefix to avoid conflicts (default: 'cron:') */
        keyPrefix?: string;
        /** Enable debug logging */
        debug?: boolean;
    });
    /**
     * Generate prefixed key
     */
    private key;
    /**
     * Log debug message if debug mode is enabled
     */
    private debug;
    /**
     * Safe Redis operation wrapper
     */
    private safeOperation;
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
     * Redis-specific utility methods
     */
    /**
     * Get information about cache usage
     */
    getStats(): Promise<{
        locks: number;
        contexts: number;
        batches: number;
    }>;
    /**
     * Clear all cache data with the configured prefix
     * WARNING: This will delete all data with the configured prefix!
     */
    clearAll(): Promise<void>;
}
