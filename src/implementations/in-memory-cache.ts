/**
 * In-memory cache implementation for Nest Cron Manager v3
 * Suitable for single-instance deployments and testing
 */

import { randomUUID } from 'crypto';
import { Cache, LockOptions, LockResult } from '../interfaces/cache.interface';

/**
 * Internal lock data structure
 */
interface LockData {
  value: string;
  expiresAt: Date;
  timeoutId: NodeJS.Timeout;
}

/**
 * Internal context data structure
 */
interface ContextData {
  value: Record<string, any>;
  expiresAt?: Date;
  timeoutId?: NodeJS.Timeout;
}

/**
 * In-memory cache implementation with TTL support
 * Thread-safe with automatic cleanup of expired items
 */
/**
 * Internal replica data structure
 */
interface ReplicaData {
  registeredAt: Date;
  expiresAt?: Date;
  timeoutId?: NodeJS.Timeout;
}

export class InMemoryCache implements Cache {
  private locks = new Map<string, LockData>();
  private contexts = new Map<string, ContextData>();
  private batches = new Map<string, number>();
  private replicas = new Map<string, ReplicaData>();

  // Simple locking mechanism for thread safety
  private lockPromise: Promise<void> = Promise.resolve();

  // Cleanup interval for expired items
  private cleanupInterval?: NodeJS.Timeout;
  public isDestroyed = false;

  constructor(
    private options: {
      /** Cleanup interval in milliseconds (default: 30 seconds) */
      cleanupIntervalMs?: number;
      /** Enable debug logging */
      debug?: boolean;
      /** Disable cleanup interval (useful for testing) */
      disableCleanup?: boolean;
    } = {},
  ) {
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
  private async withLock<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.isDestroyed) {
      throw new Error('Cache has been destroyed');
    }

    const currentLock = this.lockPromise;
    let resolveLock: () => void;

    this.lockPromise = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });

    try {
      await currentLock;
      return await operation();
    } finally {
      resolveLock!();
    }
  }

  /**
   * Log debug message if debug mode is enabled
   */
  private debug(message: string, ...args: any[]): void {
    if (this.options.debug) {
      console.debug(`[InMemoryCache] ${message}`, ...args);
    }
  }

  /**
   * Distributed locking operations
   */

  async acquireLock(key: string, options: LockOptions): Promise<LockResult> {
    try {
      return await this.withLock(() => {
        // Check if lock already exists and is not expired
        const existing = this.locks.get(key);
        if (existing && existing.expiresAt > new Date()) {
          this.debug(`Lock acquisition failed: ${key} already locked`);
          return { acquired: false };
        }

        // Generate lock value if not provided
        const lockValue = options.value ?? randomUUID();
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
    } catch (error) {
      this.debug(`Lock acquisition error for ${key}:`, error);
      return { acquired: false };
    }
  }

  async releaseLock(key: string, lockValue: string): Promise<boolean> {
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
    } catch (error) {
      this.debug(`Lock release error for ${key}:`, error);
      return false;
    }
  }

  async extendLock(key: string, lockValue: string, ttlMs: number): Promise<boolean> {
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
    } catch (error) {
      this.debug(`Lock extension error for ${key}:`, error);
      return false;
    }
  }

  /**
   * Context storage operations
   */

  async setJobContext(
    jobName: string,
    context: Record<string, any>,
    ttlMs?: number,
  ): Promise<void> {
    try {
      await this.withLock(() => {
        const key = `context:${jobName}`;

        // Clear existing timeout if any
        const existing = this.contexts.get(key);
        if (existing?.timeoutId) {
          clearTimeout(existing.timeoutId);
        }

        let timeoutId: NodeJS.Timeout | undefined;
        let expiresAt: Date | undefined;

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
    } catch (error) {
      this.debug(`Set job context error for ${jobName}:`, error);
      // Log error but don't throw to maintain interface contract
      // Consider if this should be surfaced to monitoring systems
    }
  }

  async getJobContext(jobName: string): Promise<Record<string, any> | null> {
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
    } catch (error) {
      this.debug(`Get job context error for ${jobName}:`, error);
      return null;
    }
  }

  async deleteJobContext(jobName: string): Promise<void> {
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
    } catch (error) {
      this.debug(`Delete job context error for ${jobName}:`, error);
      // Log error but don't throw to maintain interface contract
      // Consider if this should be surfaced to monitoring systems
    }
  }

  /**
   * Batch counter operations
   */

  async incrementBatch(jobName: string): Promise<number> {
    try {
      return await this.withLock(() => {
        const current = this.batches.get(jobName) ?? 0;
        const newValue = current + 1;
        this.batches.set(jobName, newValue);
        this.debug(`Batch incremented: ${jobName} = ${newValue}`);
        return newValue;
      });
    } catch (error) {
      this.debug(`Increment batch error for ${jobName}:`, error);
      return 1; // Safe fallback
    }
  }

  async getBatch(jobName: string): Promise<number> {
    try {
      return await this.withLock(() => {
        return this.batches.get(jobName) ?? 0;
      });
    } catch (error) {
      this.debug(`Get batch error for ${jobName}:`, error);
      return 0; // Safe fallback
    }
  }

  async resetBatch(jobName: string): Promise<void> {
    try {
      await this.withLock(() => {
        this.batches.delete(jobName);
        this.debug(`Batch reset: ${jobName}`);
      });
    } catch (error) {
      this.debug(`Reset batch error for ${jobName}:`, error);
      // Log error but don't throw to maintain interface contract
      // Consider if this should be surfaced to monitoring systems
    }
  }

  /**
   * Health check and cleanup
   */

  async isHealthy(): Promise<boolean> {
    try {
      // Simple health check - try to acquire and release a test lock
      const testKey = '__health_check__';
      const result = await this.acquireLock(testKey, { ttlMs: 1000 });

      if (result.acquired && result.lockValue) {
        await this.releaseLock(testKey, result.lockValue);
        return true;
      }

      return false;
    } catch (error) {
      this.debug('Health check failed:', error);
      return false;
    }
  }

  async cleanup(): Promise<void> {
    try {
      await this.performCleanup();
    } catch (error) {
      this.debug('Cleanup error:', error);
      // Log error but don't throw to maintain interface contract
      // Consider if this should be surfaced to monitoring systems
    }
  }

  /**
   * Internal cleanup operation
   */
  private async performCleanup(): Promise<void> {
    await this.withLock(() => {
      const now = new Date();
      let cleanedLocks = 0;
      let cleanedContexts = 0;
      let cleanedReplicas = 0;

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

      // Clean up expired replicas
      for (const [replicaId, replica] of this.replicas.entries()) {
        if (replica.expiresAt && replica.expiresAt <= now) {
          if (replica.timeoutId) {
            clearTimeout(replica.timeoutId);
          }
          this.replicas.delete(replicaId);
          cleanedReplicas++;
        }
      }

      if (cleanedLocks > 0 || cleanedContexts > 0 || cleanedReplicas > 0) {
        this.debug(`Cleanup completed: ${cleanedLocks} locks, ${cleanedContexts} contexts, ${cleanedReplicas} replicas`);
      }
    });
  }

  /**
   * Replica health management
   */

  async registerReplica(replicaId: string, ttlMs: number = 60000): Promise<void> {
    try {
      await this.withLock(() => {
        // Clear existing timeout if any
        const existing = this.replicas.get(replicaId);
        if (existing?.timeoutId) {
          clearTimeout(existing.timeoutId);
        }

        let timeoutId: NodeJS.Timeout | undefined;
        let expiresAt: Date | undefined;

        // Set up expiration
        expiresAt = new Date(Date.now() + ttlMs);
        timeoutId = setTimeout(() => {
          this.replicas.delete(replicaId);
          this.debug(`Replica registration expired and removed: ${replicaId}`);
        }, ttlMs);
        if (typeof timeoutId.unref === 'function') {
          timeoutId.unref();
        }

        this.replicas.set(replicaId, {
          registeredAt: new Date(),
          expiresAt,
          timeoutId,
        });

        this.debug(`Replica registered: ${replicaId}, expires at ${expiresAt.toISOString()}`);
      });
    } catch (error) {
      this.debug(`Register replica error for ${replicaId}:`, error);
    }
  }

  async pingReplica(replicaId: string): Promise<boolean> {
    try {
      return await this.withLock(() => {
        const replica = this.replicas.get(replicaId);
        
        if (!replica) {
          this.debug(`Ping failed: replica ${replicaId} not registered`);
          return false;
        }

        // Check if expired
        if (replica.expiresAt && replica.expiresAt <= new Date()) {
          if (replica.timeoutId) {
            clearTimeout(replica.timeoutId);
          }
          this.replicas.delete(replicaId);
          this.debug(`Ping failed: replica ${replicaId} expired`);
          return false;
        }

        this.debug(`Ping successful: replica ${replicaId} is active`);
        return true;
      });
    } catch (error) {
      this.debug(`Ping replica error for ${replicaId}:`, error);
      return false;
    }
  }

  async getActiveReplicas(maxAgeMs: number = 60000): Promise<string[]> {
    try {
      return await this.withLock(() => {
        const now = new Date();
        const cutoff = new Date(now.getTime() - maxAgeMs);
        const activeReplicas: string[] = [];

        for (const [replicaId, replica] of this.replicas.entries()) {
          // Check if not expired and within max age
          const isNotExpired = !replica.expiresAt || replica.expiresAt > now;
          const isWithinMaxAge = replica.registeredAt >= cutoff;

          if (isNotExpired && isWithinMaxAge) {
            activeReplicas.push(replicaId);
          } else if (!isNotExpired) {
            // Clean up expired replica
            if (replica.timeoutId) {
              clearTimeout(replica.timeoutId);
            }
            this.replicas.delete(replicaId);
            this.debug(`Removed expired replica during getActiveReplicas: ${replicaId}`);
          }
        }

        this.debug(`Found ${activeReplicas.length} active replicas: ${activeReplicas.join(', ')}`);
        return activeReplicas;
      });
    } catch (error) {
      this.debug(`Get active replicas error:`, error);
      return [];
    }
  }

  /**
   * Destroy the cache and clean up resources
   */
  async destroy(): Promise<void> {
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
    } catch (error) {
      this.debug('Error waiting for pending operations during destroy:', error);
    }

    // Clear all timeouts and data directly (without using withLock since we're destroyed)
    let clearedTimers = 0;

    // Clear lock timeouts
    for (const lock of this.locks.values()) {
      try {
        clearTimeout(lock.timeoutId);
        clearedTimers++;
      } catch (error) {
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
        } catch (error) {
          this.debug('Error clearing context timeout:', error);
        }
      }
    }
    this.contexts.clear();

    // Clear replica timeouts
    for (const replica of this.replicas.values()) {
      if (replica.timeoutId) {
        try {
          clearTimeout(replica.timeoutId);
          clearedTimers++;
        } catch (error) {
          this.debug('Error clearing replica timeout:', error);
        }
      }
    }
    this.replicas.clear();

    // Clear batches
    this.batches.clear();

    this.debug(`Cache destroyed - cleared ${clearedTimers} timers`);

    // Force cleanup of any remaining Node.js timers
    if (typeof global !== 'undefined' && global.gc) {
      try {
        global.gc();
      } catch (error) {
        this.debug('Error forcing garbage collection:', error);
      }
    }
  }

  /**
   * Get cache statistics (useful for debugging)
   */
  async getStats(): Promise<{
    locks: number;
    contexts: number;
    batches: number;
    replicas: number;
  }> {
    return this.withLock(() => ({
      locks: this.locks.size,
      contexts: this.contexts.size,
      batches: this.batches.size,
      replicas: this.replicas.size,
    }));
  }
}
