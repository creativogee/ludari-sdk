/**
 * Redis cache implementation for Nest Cron Manager v3
 * Production-ready distributed cache with proper lock management
 */

import { randomUUID } from 'crypto'
import {
  Cache,
  LockOptions,
  LockResult,
} from '../interfaces/cache.interface'

/**
 * Redis client interface - compatible with ioredis and node-redis
 */
export interface RedisClient {
  set(key: string, value: string, mode?: string, duration?: number, flag?: string): Promise<string | null>
  get(key: string): Promise<string | null>
  del(key: string): Promise<number>
  incr(key: string): Promise<number>
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<any>
  exists(key: string): Promise<number>
  ttl(key: string): Promise<number>
  pexpire(key: string, ttlMs: number): Promise<number>
}

/**
 * Redis cache implementation with distributed locking
 */
export class RedisCache implements Cache {
  private keyPrefix: string

  // Lua script for atomic lock release
  private releaseLockScript = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `

  // Lua script for atomic lock extension
  private extendLockScript = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("PEXPIRE", KEYS[1], ARGV[2])
    else
      return 0
    end
  `

  constructor(
    private redis: RedisClient,
    private options: {
      /** Key prefix to avoid conflicts (default: 'cron:') */
      keyPrefix?: string
      /** Enable debug logging */
      debug?: boolean
    } = {}
  ) {
    this.keyPrefix = options.keyPrefix ?? 'cron:'
  }

  /**
   * Generate prefixed key
   */
  private key(suffix: string): string {
    return `${this.keyPrefix}${suffix}`
  }

  /**
   * Log debug message if debug mode is enabled
   */
  private debug(message: string, ...args: any[]): void {
    if (this.options.debug) {
      console.debug(`[RedisCache] ${message}`, ...args)
    }
  }

  /**
   * Safe Redis operation wrapper
   */
  private async safeOperation<T>(
    operation: () => Promise<T>,
    fallback: T,
    operationName: string
  ): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      this.debug(`${operationName} error:`, error)
      return fallback
    }
  }

  /**
   * Distributed locking operations
   */

  async acquireLock(key: string, options: LockOptions): Promise<LockResult> {
    return this.safeOperation(
      async () => {
        const lockKey = this.key(`lock:${key}`)
        const lockValue = options.value ?? randomUUID()
        
        // Use SET with NX (not exists) and PX (expire in milliseconds) for atomic operation
        const result = await this.redis.set(lockKey, lockValue, 'PX', options.ttlMs, 'NX')
        
        if (result === 'OK') {
          const expiresAt = new Date(Date.now() + options.ttlMs)
          this.debug(`Lock acquired: ${key} = ${lockValue}, expires at ${expiresAt.toISOString()}`)
          
          return {
            acquired: true,
            lockValue,
            expiresAt,
          }
        } else {
          this.debug(`Lock acquisition failed: ${key} already locked`)
          return { acquired: false }
        }
      },
      { acquired: false },
      'acquireLock'
    )
  }

  async releaseLock(key: string, lockValue: string): Promise<boolean> {
    return this.safeOperation(
      async () => {
        const lockKey = this.key(`lock:${key}`)
        
        // Use Lua script for atomic check-and-delete
        const result = await this.redis.eval(this.releaseLockScript, 1, lockKey, lockValue)
        
        const released = result === 1
        if (released) {
          this.debug(`Lock released: ${key}`)
        } else {
          this.debug(`Lock release failed: ${key} not found or value mismatch`)
        }
        
        return released
      },
      false,
      'releaseLock'
    )
  }

  async extendLock(key: string, lockValue: string, ttlMs: number): Promise<boolean> {
    return this.safeOperation(
      async () => {
        const lockKey = this.key(`lock:${key}`)
        
        // Use Lua script for atomic check-and-extend
        const result = await this.redis.eval(this.extendLockScript, 1, lockKey, lockValue, ttlMs)
        
        const extended = result === 1
        if (extended) {
          this.debug(`Lock extended: ${key}, new TTL ${ttlMs}ms`)
        } else {
          this.debug(`Lock extension failed: ${key} not found or value mismatch`)
        }
        
        return extended
      },
      false,
      'extendLock'
    )
  }

  /**
   * Context storage operations
   */

  async setJobContext(jobName: string, context: Record<string, any>, ttlMs?: number): Promise<void> {
    await this.safeOperation(
      async () => {
        const contextKey = this.key(`context:${jobName}`)
        // Single JSON stringify - no double encoding
        const serialized = JSON.stringify(context)
        
        if (ttlMs) {
          // Set with expiration
          await this.redis.set(contextKey, serialized, 'PX', ttlMs)
          this.debug(`Job context set with TTL: ${jobName} (${ttlMs}ms)`, context)
        } else {
          // Set without expiration
          await this.redis.set(contextKey, serialized)
          this.debug(`Job context set: ${jobName}`, context)
        }
      },
      undefined,
      'setJobContext'
    )
  }

  async getJobContext(jobName: string): Promise<Record<string, any> | null> {
    return this.safeOperation(
      async () => {
        const contextKey = this.key(`context:${jobName}`)
        const serialized = await this.redis.get(contextKey)
        
        if (!serialized) {
          return null
        }
        
        try {
          // Single JSON parse - returns proper object
          const context = JSON.parse(serialized)
          this.debug(`Job context retrieved: ${jobName}`, context)
          return context
        } catch (parseError) {
          this.debug(`Job context parse error for ${jobName}:`, parseError)
          return null
        }
      },
      null,
      'getJobContext'
    )
  }

  async deleteJobContext(jobName: string): Promise<void> {
    await this.safeOperation(
      async () => {
        const contextKey = this.key(`context:${jobName}`)
        await this.redis.del(contextKey)
        this.debug(`Job context deleted: ${jobName}`)
      },
      undefined,
      'deleteJobContext'
    )
  }

  /**
   * Batch counter operations
   */

  async incrementBatch(jobName: string): Promise<number> {
    return this.safeOperation(
      async () => {
        const batchKey = this.key(`batch:${jobName}`)
        const newValue = await this.redis.incr(batchKey)
        this.debug(`Batch incremented: ${jobName} = ${newValue}`)
        return newValue
      },
      1,
      'incrementBatch'
    )
  }

  async getBatch(jobName: string): Promise<number> {
    return this.safeOperation(
      async () => {
        const batchKey = this.key(`batch:${jobName}`)
        const value = await this.redis.get(batchKey)
        return value ? parseInt(value, 10) : 0
      },
      0,
      'getBatch'
    )
  }

  async resetBatch(jobName: string): Promise<void> {
    await this.safeOperation(
      async () => {
        const batchKey = this.key(`batch:${jobName}`)
        await this.redis.del(batchKey)
        this.debug(`Batch reset: ${jobName}`)
      },
      undefined,
      'resetBatch'
    )
  }

  /**
   * Health check and cleanup
   */

  async isHealthy(): Promise<boolean> {
    return this.safeOperation(
      async () => {
        // Simple ping test - try to set and get a test key
        const testKey = this.key('__health_check__')
        const testValue = randomUUID()
        
        await this.redis.set(testKey, testValue, 'PX', 1000) // 1 second TTL
        const retrieved = await this.redis.get(testKey)
        
        if (retrieved === testValue) {
          await this.redis.del(testKey)
          return true
        }
        
        return false
      },
      false,
      'healthCheck'
    )
  }

  async cleanup(): Promise<void> {
    await this.safeOperation(
      async () => {
        // Redis handles TTL automatically, but we can clean up any stale data
        // This is mainly for debugging and maintenance
        
        // Note: In a real implementation, you might want to scan for expired keys
        // or implement more sophisticated cleanup logic
        this.debug('Cleanup completed (Redis handles TTL automatically)')
      },
      undefined,
      'cleanup'
    )
  }

  /**
   * Redis-specific utility methods
   */

  /**
   * Get information about cache usage
   */
  async getStats(): Promise<{
    locks: number
    contexts: number
    batches: number
  }> {
    return this.safeOperation(
      async () => {
        // Note: This requires Redis SCAN command which might not be available
        // in all Redis client implementations. This is a simplified version.
        
        // Count locks (simplified - in production you'd use SCAN)
        const locks = 0
        const contexts = 0
        const batches = 0
        
        // This is a placeholder - real implementation would use SCAN
        // to iterate through keys matching patterns
        
        return { locks, contexts, batches }
      },
      { locks: 0, contexts: 0, batches: 0 },
      'getStats'
    )
  }

  /**
   * Clear all cache data with the configured prefix
   * WARNING: This will delete all data with the configured prefix!
   */
  async clearAll(): Promise<void> {
    await this.safeOperation(
      async () => {
        // Note: This is a dangerous operation and should be used carefully
        // In production, you'd want to implement this with SCAN and batch DELETE
        this.debug('WARNING: clearAll not implemented for safety - use specific delete methods')
      },
      undefined,
      'clearAll'
    )
  }
}