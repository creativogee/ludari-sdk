import { RedisCache, RedisClient } from './redis-cache';

describe('RedisCache', () => {
  let redis: jest.Mocked<RedisClient>;
  let cache: RedisCache;

  beforeEach(() => {
    redis = {
      set: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
      incr: jest.fn(),
      eval: jest.fn(),
      exists: jest.fn(),
      ttl: jest.fn(),
      pexpire: jest.fn(),
    };
    cache = new RedisCache(redis, { keyPrefix: 'test:', debug: false });
  });

  describe('locks', () => {
    it('acquires lock when SET returns OK', async () => {
      redis.set.mockResolvedValue('OK');
      const result = await cache.acquireLock('key', { ttlMs: 1000 });
      expect(result.acquired).toBe(true);
      expect(result.lockValue).toBeDefined();
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(redis.set).toHaveBeenCalledWith('test:lock:key', expect.any(String), 'PX', 1000, 'NX');
    });

    it('does not acquire lock when SET returns null', async () => {
      redis.set.mockResolvedValue(null);
      const result = await cache.acquireLock('key', { ttlMs: 1000 });
      expect(result).toEqual({ acquired: false });
    });

    it('returns acquired:false on acquire error', async () => {
      redis.set.mockRejectedValue(new Error('redis down'));
      const result = await cache.acquireLock('key', { ttlMs: 1000 });
      expect(result).toEqual({ acquired: false });
    });

    it('releases lock with eval script (success)', async () => {
      redis.eval.mockResolvedValue(1);
      const released = await cache.releaseLock('key', 'value');
      expect(released).toBe(true);
      expect(redis.eval).toHaveBeenCalled();
    });

    it('returns false when release fails', async () => {
      redis.eval.mockResolvedValue(0);
      const released = await cache.releaseLock('key', 'value');
      expect(released).toBe(false);
    });

    it('returns false on release error', async () => {
      redis.eval.mockRejectedValue(new Error('boom'));
      const released = await cache.releaseLock('key', 'value');
      expect(released).toBe(false);
    });

    it('extends lock TTL (success)', async () => {
      redis.eval.mockResolvedValue(1);
      const ok = await cache.extendLock('key', 'value', 5000);
      expect(ok).toBe(true);
      expect(redis.eval).toHaveBeenCalled();
    });

    it('returns false when extend fails', async () => {
      redis.eval.mockResolvedValue(0);
      const ok = await cache.extendLock('key', 'value', 5000);
      expect(ok).toBe(false);
    });

    it('returns false on extend error', async () => {
      redis.eval.mockRejectedValue(new Error('boom'));
      const ok = await cache.extendLock('key', 'value', 5000);
      expect(ok).toBe(false);
    });
  });

  describe('context', () => {
    it('sets context with TTL', async () => {
      redis.set.mockResolvedValue('OK');
      await cache.setJobContext('job', { a: 1 }, 2000);
      expect(redis.set).toHaveBeenCalledWith(
        'test:context:job',
        JSON.stringify({ a: 1 }),
        'PX',
        2000,
      );
    });

    it('sets context without TTL', async () => {
      redis.set.mockResolvedValue('OK');
      await cache.setJobContext('job', { a: 1 });
      expect(redis.set).toHaveBeenCalledWith('test:context:job', JSON.stringify({ a: 1 }));
    });

    it('gets context and parses JSON', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ a: 1 }));
      const ctx = await cache.getJobContext('job');
      expect(ctx).toEqual({ a: 1 });
    });

    it('returns null when context missing', async () => {
      redis.get.mockResolvedValue(null);
      const ctx = await cache.getJobContext('job');
      expect(ctx).toBeNull();
    });

    it('returns null on parse error', async () => {
      redis.get.mockResolvedValue('not-json');
      const ctx = await cache.getJobContext('job');
      expect(ctx).toBeNull();
    });

    it('returns null on get error', async () => {
      redis.get.mockRejectedValue(new Error('boom'));
      const ctx = await cache.getJobContext('job');
      expect(ctx).toBeNull();
    });

    it('deletes context', async () => {
      redis.del.mockResolvedValue(1);
      await cache.deleteJobContext('job');
      expect(redis.del).toHaveBeenCalledWith('test:context:job');
    });
  });

  describe('batch', () => {
    it('increments batch counter', async () => {
      redis.incr.mockResolvedValue(3);
      const val = await cache.incrementBatch('job');
      expect(val).toBe(3);
      expect(redis.incr).toHaveBeenCalledWith('test:batch:job');
    });

    it('increment fallback on error', async () => {
      redis.incr.mockRejectedValue(new Error('boom'));
      const val = await cache.incrementBatch('job');
      expect(val).toBe(1);
    });

    it('gets batch counter', async () => {
      redis.get.mockResolvedValue('7');
      const val = await cache.getBatch('job');
      expect(val).toBe(7);
    });

    it('get batch returns 0 when missing', async () => {
      redis.get.mockResolvedValue(null);
      const val = await cache.getBatch('job');
      expect(val).toBe(0);
    });

    it('get batch fallback on error', async () => {
      redis.get.mockRejectedValue(new Error('boom'));
      const val = await cache.getBatch('job');
      expect(val).toBe(0);
    });

    it('resets batch counter', async () => {
      redis.del.mockResolvedValue(1);
      await cache.resetBatch('job');
      expect(redis.del).toHaveBeenCalledWith('test:batch:job');
    });
  });

  describe('health and maintenance', () => {
    it('isHealthy returns true when roundtrip works', async () => {
      let capturedValue = '';
      redis.set.mockImplementation(async (_key: string, value: string) => {
        capturedValue = value;
        return 'OK';
      });
      redis.get.mockImplementation(async () => capturedValue);
      redis.del.mockResolvedValue(1);
      const healthy = await cache.isHealthy();
      expect(healthy).toBe(true);
    });

    it('isHealthy returns false when values mismatch', async () => {
      redis.set.mockResolvedValue('OK');
      redis.get.mockResolvedValue('different');
      const healthy = await cache.isHealthy();
      expect(healthy).toBe(false);
    });

    it('isHealthy returns false on error', async () => {
      redis.set.mockRejectedValue(new Error('boom'));
      const healthy = await cache.isHealthy();
      expect(healthy).toBe(false);
    });

    it('cleanup does not throw', async () => {
      // Enable debug to exercise debug branch
      cache = new RedisCache(redis, { keyPrefix: 'test:', debug: true });
      await expect(cache.cleanup()).resolves.toBeUndefined();
    });

    it('getStats returns placeholders and handles errors', async () => {
      const stats = await cache.getStats();
      expect(stats).toEqual({ locks: 0, contexts: 0, batches: 0 });

      // Force error path
      const cache2 = new RedisCache({
        ...redis,
        get: jest.fn().mockRejectedValue(new Error('x')),
      } as any);
      const stats2 = await cache2.getStats();
      expect(stats2).toEqual({ locks: 0, contexts: 0, batches: 0 });
    });

    it('clearAll does not throw', async () => {
      await expect(cache.clearAll()).resolves.toBeUndefined();
    });
  });
});
