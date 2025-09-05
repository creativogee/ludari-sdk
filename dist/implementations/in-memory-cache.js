"use strict";
/**
 * In-memory cache implementation for Nest Cron Manager v3
 * Suitable for single-instance deployments and testing
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryCache = void 0;
const crypto_1 = require("crypto");
/**
 * In-memory cache implementation with TTL support
 * Thread-safe with automatic cleanup of expired items
 */
class InMemoryCache {
    constructor(options = {}) {
        this.options = options;
        this.locks = new Map();
        this.contexts = new Map();
        this.batches = new Map();
        // Simple locking mechanism for thread safety
        this.lockPromise = Promise.resolve();
        this.isDestroyed = false;
        const cleanupIntervalMs = options.cleanupIntervalMs ?? 30000;
        // Set up periodic cleanup only if not disabled
        if (!options.disableCleanup) {
            this.cleanupInterval = setInterval(() => {
                this.performCleanup().catch((error) => {
                    // Log cleanup errors instead of silently ignoring them
                    this.debug('Cleanup failed:', error);
                    // In case of persistent cleanup failures, attempt to recreate internal state
                    if (error instanceof Error && error.message.includes('destroyed')) {
                        // Cache was destroyed but interval wasn't cleared - clear it now
                        if (this.cleanupInterval) {
                            clearInterval(this.cleanupInterval);
                            this.cleanupInterval = undefined;
                        }
                    }
                });
            }, cleanupIntervalMs);
            // Do not keep the process alive because of periodic cleanup
            if (typeof this.cleanupInterval.unref === 'function') {
                this.cleanupInterval.unref();
            }
        }
    }
    /**
     * Execute operation with exclusive lock
     */
    async withLock(operation) {
        if (this.isDestroyed) {
            throw new Error('Cache has been destroyed');
        }
        const currentLock = this.lockPromise;
        let resolveLock;
        this.lockPromise = new Promise((resolve) => {
            resolveLock = resolve;
        });
        try {
            await currentLock;
            return await operation();
        }
        finally {
            resolveLock();
        }
    }
    /**
     * Log debug message if debug mode is enabled
     */
    debug(message, ...args) {
        if (this.options.debug) {
            console.debug(`[InMemoryCache] ${message}`, ...args);
        }
    }
    /**
     * Distributed locking operations
     */
    async acquireLock(key, options) {
        try {
            return await this.withLock(() => {
                // Check if lock already exists and is not expired
                const existing = this.locks.get(key);
                if (existing && existing.expiresAt > new Date()) {
                    this.debug(`Lock acquisition failed: ${key} already locked`);
                    return { acquired: false };
                }
                // Generate lock value if not provided
                const lockValue = options.value ?? (0, crypto_1.randomUUID)();
                const expiresAt = new Date(Date.now() + options.ttlMs);
                // Set up automatic cleanup timeout
                const timeoutId = setTimeout(() => {
                    this.locks.delete(key);
                    this.debug(`Lock expired and removed: ${key}`);
                }, options.ttlMs);
                if (typeof timeoutId.unref === 'function') {
                    timeoutId.unref();
                }
                // Store the lock
                this.locks.set(key, {
                    value: lockValue,
                    expiresAt,
                    timeoutId,
                });
                this.debug(`Lock acquired: ${key} = ${lockValue}, expires at ${expiresAt.toISOString()}`);
                return {
                    acquired: true,
                    lockValue,
                    expiresAt,
                };
            });
        }
        catch (error) {
            this.debug(`Lock acquisition error for ${key}:`, error);
            return { acquired: false };
        }
    }
    async releaseLock(key, lockValue) {
        try {
            return await this.withLock(() => {
                const existing = this.locks.get(key);
                // Check if lock exists and values match
                if (!existing || existing.value !== lockValue) {
                    this.debug(`Lock release failed: ${key} not found or value mismatch`);
                    return false;
                }
                // Clear the timeout and remove the lock
                clearTimeout(existing.timeoutId);
                this.locks.delete(key);
                this.debug(`Lock released: ${key}`);
                return true;
            });
        }
        catch (error) {
            this.debug(`Lock release error for ${key}:`, error);
            return false;
        }
    }
    async extendLock(key, lockValue, ttlMs) {
        try {
            return await this.withLock(() => {
                const existing = this.locks.get(key);
                // Check if lock exists and values match
                if (!existing || existing.value !== lockValue) {
                    this.debug(`Lock extension failed: ${key} not found or value mismatch`);
                    return false;
                }
                // Clear the old timeout
                clearTimeout(existing.timeoutId);
                // Set new expiration time and timeout
                const expiresAt = new Date(Date.now() + ttlMs);
                const timeoutId = setTimeout(() => {
                    this.locks.delete(key);
                    this.debug(`Extended lock expired and removed: ${key}`);
                }, ttlMs);
                if (typeof timeoutId.unref === 'function') {
                    timeoutId.unref();
                }
                // Update the lock
                this.locks.set(key, {
                    value: lockValue,
                    expiresAt,
                    timeoutId,
                });
                this.debug(`Lock extended: ${key}, new expiry ${expiresAt.toISOString()}`);
                return true;
            });
        }
        catch (error) {
            this.debug(`Lock extension error for ${key}:`, error);
            return false;
        }
    }
    /**
     * Context storage operations
     */
    async setJobContext(jobName, context, ttlMs) {
        try {
            await this.withLock(() => {
                const key = `context:${jobName}`;
                // Clear existing timeout if any
                const existing = this.contexts.get(key);
                if (existing?.timeoutId) {
                    clearTimeout(existing.timeoutId);
                }
                let timeoutId;
                let expiresAt;
                // Set up expiration if TTL is provided
                if (ttlMs) {
                    expiresAt = new Date(Date.now() + ttlMs);
                    timeoutId = setTimeout(() => {
                        this.contexts.delete(key);
                        this.debug(`Job context expired and removed: ${jobName}`);
                    }, ttlMs);
                    if (typeof timeoutId.unref === 'function') {
                        timeoutId.unref();
                    }
                }
                this.contexts.set(key, {
                    value: structuredClone(context), // Deep clone without double stringify
                    expiresAt,
                    timeoutId,
                });
                this.debug(`Job context set: ${jobName}`, context);
            });
        }
        catch (error) {
            this.debug(`Set job context error for ${jobName}:`, error);
            // Log error but don't throw to maintain interface contract
            // Consider if this should be surfaced to monitoring systems
        }
    }
    async getJobContext(jobName) {
        try {
            return await this.withLock(() => {
                const key = `context:${jobName}`;
                const data = this.contexts.get(key);
                if (!data) {
                    return null;
                }
                // Check if expired
                if (data.expiresAt && data.expiresAt <= new Date()) {
                    if (data.timeoutId) {
                        clearTimeout(data.timeoutId);
                    }
                    this.contexts.delete(key);
                    this.debug(`Job context expired: ${jobName}`);
                    return null;
                }
                this.debug(`Job context retrieved: ${jobName}`, data.value);
                return structuredClone(data.value); // Deep clone without double stringify
            });
        }
        catch (error) {
            this.debug(`Get job context error for ${jobName}:`, error);
            return null;
        }
    }
    async deleteJobContext(jobName) {
        try {
            await this.withLock(() => {
                const key = `context:${jobName}`;
                const existing = this.contexts.get(key);
                if (existing?.timeoutId) {
                    clearTimeout(existing.timeoutId);
                }
                this.contexts.delete(key);
                this.debug(`Job context deleted: ${jobName}`);
            });
        }
        catch (error) {
            this.debug(`Delete job context error for ${jobName}:`, error);
            // Log error but don't throw to maintain interface contract
            // Consider if this should be surfaced to monitoring systems
        }
    }
    /**
     * Batch counter operations
     */
    async incrementBatch(jobName) {
        try {
            return await this.withLock(() => {
                const current = this.batches.get(jobName) ?? 0;
                const newValue = current + 1;
                this.batches.set(jobName, newValue);
                this.debug(`Batch incremented: ${jobName} = ${newValue}`);
                return newValue;
            });
        }
        catch (error) {
            this.debug(`Increment batch error for ${jobName}:`, error);
            return 1; // Safe fallback
        }
    }
    async getBatch(jobName) {
        try {
            return await this.withLock(() => {
                return this.batches.get(jobName) ?? 0;
            });
        }
        catch (error) {
            this.debug(`Get batch error for ${jobName}:`, error);
            return 0; // Safe fallback
        }
    }
    async resetBatch(jobName) {
        try {
            await this.withLock(() => {
                this.batches.delete(jobName);
                this.debug(`Batch reset: ${jobName}`);
            });
        }
        catch (error) {
            this.debug(`Reset batch error for ${jobName}:`, error);
            // Log error but don't throw to maintain interface contract
            // Consider if this should be surfaced to monitoring systems
        }
    }
    /**
     * Health check and cleanup
     */
    async isHealthy() {
        try {
            // Simple health check - try to acquire and release a test lock
            const testKey = '__health_check__';
            const result = await this.acquireLock(testKey, { ttlMs: 1000 });
            if (result.acquired && result.lockValue) {
                await this.releaseLock(testKey, result.lockValue);
                return true;
            }
            return false;
        }
        catch (error) {
            this.debug('Health check failed:', error);
            return false;
        }
    }
    async cleanup() {
        try {
            await this.performCleanup();
        }
        catch (error) {
            this.debug('Cleanup error:', error);
            // Log error but don't throw to maintain interface contract
            // Consider if this should be surfaced to monitoring systems
        }
    }
    /**
     * Internal cleanup operation
     */
    async performCleanup() {
        await this.withLock(() => {
            const now = new Date();
            let cleanedLocks = 0;
            let cleanedContexts = 0;
            // Clean up expired locks
            for (const [key, lock] of this.locks.entries()) {
                if (lock.expiresAt <= now) {
                    clearTimeout(lock.timeoutId);
                    this.locks.delete(key);
                    cleanedLocks++;
                }
            }
            // Clean up expired contexts
            for (const [key, context] of this.contexts.entries()) {
                if (context.expiresAt && context.expiresAt <= now) {
                    if (context.timeoutId) {
                        clearTimeout(context.timeoutId);
                    }
                    this.contexts.delete(key);
                    cleanedContexts++;
                }
            }
            if (cleanedLocks > 0 || cleanedContexts > 0) {
                this.debug(`Cleanup completed: ${cleanedLocks} locks, ${cleanedContexts} contexts`);
            }
        });
    }
    /**
     * Replica health management
     */
    async pingReplica(replicaId) {
        try {
            // InMemoryCache doesn't track replicas without registerReplica
            // Always return false to indicate "cannot determine health"
            this.debug(`Ping failed: InMemoryCache doesn't track replicas (${replicaId})`);
            return false;
        }
        catch (error) {
            this.debug(`Ping replica error for ${replicaId}:`, error);
            return false;
        }
    }
    /**
     * Destroy the cache and clean up resources
     */
    async destroy() {
        if (this.isDestroyed) {
            return; // Already destroyed, prevent double cleanup
        }
        this.isDestroyed = true;
        // Clear cleanup interval first to prevent new cleanup operations
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = undefined;
        }
        // Wait for any pending operations to complete
        try {
            await this.lockPromise;
        }
        catch (error) {
            this.debug('Error waiting for pending operations during destroy:', error);
        }
        // Clear all timeouts and data directly (without using withLock since we're destroyed)
        let clearedTimers = 0;
        // Clear lock timeouts
        for (const lock of this.locks.values()) {
            try {
                clearTimeout(lock.timeoutId);
                clearedTimers++;
            }
            catch (error) {
                this.debug('Error clearing lock timeout:', error);
            }
        }
        this.locks.clear();
        // Clear context timeouts
        for (const context of this.contexts.values()) {
            if (context.timeoutId) {
                try {
                    clearTimeout(context.timeoutId);
                    clearedTimers++;
                }
                catch (error) {
                    this.debug('Error clearing context timeout:', error);
                }
            }
        }
        this.contexts.clear();
        // Clear batches
        this.batches.clear();
        this.debug(`Cache destroyed - cleared ${clearedTimers} timers`);
        // Force cleanup of any remaining Node.js timers
        if (typeof global !== 'undefined' && global.gc) {
            try {
                global.gc();
            }
            catch (error) {
                this.debug('Error forcing garbage collection:', error);
            }
        }
    }
    /**
     * Get cache statistics (useful for debugging)
     */
    async getStats() {
        return this.withLock(() => ({
            locks: this.locks.size,
            contexts: this.contexts.size,
            batches: this.batches.size,
        }));
    }
}
exports.InMemoryCache = InMemoryCache;
