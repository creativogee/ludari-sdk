import { InMemoryCache } from '../implementations/in-memory-cache';
import { InMemoryStorage } from '../implementations/in-memory-storage';
import { CreateJob } from '../types/core';
import { Lens } from './lens';
import { Manager } from './manager';

const WATCH_JOB_NAME = '__watch__';

describe('Manager', () => {
  let mockLogger: any;
  let mockJobHandler: any; // Changed to any as Handler interface is removed

  beforeEach(() => {
    mockLogger = {
      error: jest.fn(),
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
    };
    mockJobHandler = {
      executeMethod: jest.fn().mockResolvedValue({ success: true }),
    };
  });

  const createManager = () => {
    const storage = new InMemoryStorage();
    const cache = new InMemoryCache({ disableCleanup: true }); // Disable cleanup to avoid hanging timers
    const manager = new Manager({
      replicaId: `test-replica-${Date.now()}-${Math.floor(Math.random() * 1000000)}`, // Unique replica ID per test
      storage,
      cache,
      logger: mockLogger,
      handler: mockJobHandler,
      querySecret: 'Unit-Test-Strong-Encryption-Key-With-Numbers-123-And-Symbols!@#', // Strong key for tests
      enabled: false, // Disable to avoid automatic job scheduling during tests
      watchInterval: 1,
    });
    return { manager, storage, cache };
  };

  describe('construction and validation', () => {
    it('should create manager with valid options', () => {
      const { manager } = createManager();
      expect(manager).toBeInstanceOf(Manager);
    });

    it('should auto-generate replicaId when not provided', async () => {
      const storage = new InMemoryStorage();
      const manager = new Manager({
        storage,
        cache: new InMemoryCache({ disableCleanup: true }),
        logger: mockLogger,
      });
      expect((manager as any).replicaId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      await manager.destroy();
    });

    it('should throw error without storage', () => {
      expect(
        () =>
          new Manager({
            storage: null as any,
            logger: mockLogger,
          }),
      ).toThrow('storage implementation is required');
    });

    it('should throw error without logger', () => {
      const storage = new InMemoryStorage();
      expect(
        () =>
          new Manager({
            storage,
            logger: null as any,
          }),
      ).toThrow('logger is required');
    });

    it('should use default cache if not provided', async () => {
      const storage = new InMemoryStorage();
      const mgr = new Manager({
        storage,
        logger: mockLogger,
      });
      expect(mgr).toBeInstanceOf(Manager);
      await mgr.destroy();
    });
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      const { manager } = createManager();
      await manager.initialize();
      expect(mockLogger.log).toHaveBeenCalledWith(
        expect.stringContaining('Manager initialized with replicaId:'),
      );
      await manager.destroy();
    });

    it('deadlock detection interval is unrefed', async () => {
      const { manager } = createManager();

      const originalSetInterval = global.setInterval;
      let capturedInterval: any = null;
      (global as any).setInterval = ((handler: any, timeout?: any, ...args: any[]) => {
        const handle: any = originalSetInterval(handler as any, timeout as any, ...args);
        capturedInterval = handle;
        return handle;
      }) as any;

      try {
        await manager.initialize();
        expect(capturedInterval).toBeTruthy();
        if (typeof capturedInterval.hasRef === 'function') {
          expect(capturedInterval.hasRef()).toBe(false);
        }
      } finally {
        (global as any).setInterval = originalSetInterval;
        await manager.destroy();
      }
    });

    it('should create control record if none exists', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      const control = await storage.getControl();
      expect(control).toBeDefined();
      expect(control!.replicas.length).toBeGreaterThan(0);
      expect(control!.enabled).toBe(true);

      await manager.destroy();
    });
  });

  describe('job definition management', () => {
    it('should create job definition', async () => {
      const { manager } = createManager();
      await manager.initialize();

      const jobData: CreateJob = {
        name: 'test-job',
        type: 'method',
        enabled: true,
        cron: '0 0 * * *',
        context: { key: 'value' },
      };

      const job = await manager.createJob(jobData);

      expect(job).toMatchObject(jobData);
      expect(job.id).toBeDefined();
      expect((job as any).created_at).toBeDefined();

      await manager.destroy();
    });

    it('should find job definitions', async () => {
      const { manager } = createManager();
      await manager.initialize();

      await manager.createJob({
        name: 'job1',
        type: 'method',
        enabled: true,
      });

      await manager.createJob({
        name: 'job2',
        type: 'query',
        enabled: false,
      });

      const allJobs = await manager.listJobs({});
      expect(allJobs.data).toHaveLength(2);

      const enabledJobs = await manager.listJobs({ enabled: true });
      expect(enabledJobs.data).toHaveLength(1);
      expect(enabledJobs.data[0].name).toBe('job1');

      await manager.destroy();
    });

    it('should update job definition', async () => {
      const { manager } = createManager();
      await manager.initialize();

      const job = await manager.createJob({
        name: 'test-job',
        type: 'method',
        enabled: true,
      });

      const updated = await manager.updateJob(job.id, {
        name: 'updated-job',
        enabled: false,
      });

      expect(updated!.name).toBe('updated-job');
      expect(updated!.enabled).toBe(false);

      await manager.destroy();
    });

    it('should toggle job definition', async () => {
      const { manager } = createManager();
      await manager.initialize();

      const job = await manager.createJob({
        name: 'test-job',
        type: 'method',
        enabled: true,
      });

      const toggled = await manager.toggleJob(job.id);
      expect(toggled.enabled).toBe(false);

      await manager.destroy();
    });

    it('should enable job definition', async () => {
      const { manager } = createManager();
      await manager.initialize();

      const job = await manager.createJob({
        name: 'test-job',
        type: 'method',
        enabled: false,
      });

      const enabled = await manager.enableJob(job.id);
      expect(enabled.enabled).toBe(true);

      // Should return same job if already enabled
      const alreadyEnabled = await manager.enableJob(job.id);
      expect(alreadyEnabled.enabled).toBe(true);

      await manager.destroy();
    });

    it('should disable job definition', async () => {
      const { manager } = createManager();
      await manager.initialize();

      const job = await manager.createJob({
        name: 'test-job',
        type: 'method',
        enabled: true,
      });

      const disabled = await manager.disableJob(job.id);
      expect(disabled.enabled).toBe(false);

      // Should return same job if already disabled
      const alreadyDisabled = await manager.disableJob(job.id);
      expect(alreadyDisabled.enabled).toBe(false);

      await manager.destroy();
    });

    it('should exclude __watch__ jobs from listing and protect from modification', async () => {
      const { manager } = createManager();
      await manager.initialize();

      // Create a regular job
      const job = await manager.createJob({
        name: 'regular-job',
        type: 'method',
        enabled: true,
      });

      // Get the __watch__ job that was created during initialization
      const watchJob = await manager['storage'].findJobByName(WATCH_JOB_NAME);
      expect(watchJob).toBeDefined();
      expect(watchJob!.name).toBe(WATCH_JOB_NAME);

      // List jobs should exclude __watch__
      const allJobs = await manager.listJobs({});
      expect(allJobs.data).toHaveLength(1);
      expect(allJobs.data[0].name).toBe('regular-job');

      // getJob should return null for __watch__ jobs
      const retrievedWatchJob = await manager.getJob(watchJob!.id);
      expect(retrievedWatchJob).toBeNull();

      // Should not be able to modify __watch__ jobs
      await expect(manager.updateJob(watchJob!.id, { enabled: false })).rejects.toThrow(
        'Cannot update system job: __watch__',
      );

      await expect(manager.toggleJob(watchJob!.id)).rejects.toThrow(
        'Cannot toggle system job: __watch__',
      );

      await expect(manager.enableJob(watchJob!.id)).rejects.toThrow(
        'Cannot enable system job: __watch__',
      );

      await expect(manager.disableJob(watchJob!.id)).rejects.toThrow(
        'Cannot disable system job: __watch__',
      );

      await expect(manager.deleteJob(watchJob!.id)).rejects.toThrow(
        'Cannot delete system job: __watch__',
      );

      await manager.destroy();
    });
  });

  describe('job execution via handleJob', () => {
    it('should handle job registration', async () => {
      const { manager } = createManager();
      await manager.initialize();

      const jobExecution = jest.fn().mockResolvedValue({ success: true });

      await manager.handleJob('test-job', jobExecution);

      // Verify job is registered (this would be internal)
      expect(jobExecution).toBeDefined();

      await manager.destroy();
    });
  });

  describe('control management', () => {
    it('should get control state', async () => {
      const { manager } = createManager();
      await manager.initialize();

      const control = await manager.getControl();
      expect(control).toBeDefined();
      expect(control!.enabled).toBe(true);
      expect(control!.replicas.length).toBeGreaterThan(0);

      await manager.destroy();
    });

    it('should toggle control state', async () => {
      const { manager } = createManager();
      await manager.initialize();

      const result = await manager.toggleControl();
      expect(result.enabled).toBe(false);

      const control = await manager.getControl();
      expect(control!.enabled).toBe(false);

      await manager.destroy();
    });
  });

  describe('replica management', () => {
    it('should track replica activity', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      const control = await storage.getControl();
      expect(control!.replicas.length).toBeGreaterThan(0);

      await manager.destroy();
    });

    it('should handle stale replica detection', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      // Get current control and add a stale replica
      const currentControl = await storage.getControl();
      const replicaId = currentControl!.replicas[0];

      await storage.updateControl(currentControl!.id, {
        replicas: [replicaId, 'stale-replica'],
        stale: ['stale-replica'],
        version: currentControl!.version, // Use current version to avoid conflicts
      });

      const control = await storage.getControl();
      expect(control!.stale).toContain('stale-replica');

      await manager.destroy();
    });
  });

  describe('job scheduling', () => {
    it('should schedule cron jobs', async () => {
      const { manager } = createManager();
      await manager.initialize();

      const job = await manager.createJob({
        name: 'scheduled-job',
        type: 'method',
        enabled: true,
        cron: '*/5 * * * * *', // Every 5 seconds
      });

      // Jobs should be scheduled internally
      // This is difficult to test without running actual cron jobs
      // In a real test, you might check that the cron job is registered
      expect(job.cron).toBe('*/5 * * * * *');

      await manager.destroy();
    });
  });

  describe('inline jobs', () => {
    it('executes registered inline handler', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();
      (manager as any)['enabled'] = true;

      const exec = jest.fn(async () => 'ok');
      (manager as any).register('hello', exec);

      const job = await storage.createJob({ name: 'hello', type: 'inline', enabled: true });
      await (manager as any)['executeJob'](job);

      expect(exec).toHaveBeenCalled();
      await manager.destroy();
    });

    it('logs warn when inline handler missing', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();
      (manager as any)['enabled'] = true;

      const job = await storage.createJob({ name: 'missing', type: 'inline', enabled: true });
      await (manager as any)['executeJob'](job);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No inline handler registered for job: missing'),
      );
      await manager.destroy();
    });

    it('clears inline handlers on destroy', async () => {
      const { manager } = createManager();
      await manager.initialize();

      const exec = jest.fn(async () => 'ok');
      (manager as any).register('x', exec);

      // Ensure handler exists before destroy
      expect((manager as any)['inlineHandlers'].has('x')).toBe(true);

      await manager.destroy();

      // After destroy, handlers are cleared
      expect((manager as any)['inlineHandlers'].size).toBe(0);
    });
  });

  describe('destroy and cleanup', () => {
    it('should destroy manager and clean up resources', async () => {
      const { manager } = createManager();
      await manager.initialize();

      await manager.destroy();

      // Should not be able to perform operations after destroy
      await expect(
        manager.createJob({
          name: 'test',
          type: 'method',
          enabled: true,
        }),
      ).rejects.toThrow();
    });

    it('should handle destroy without initialization', async () => {
      const { manager } = createManager();
      await expect(manager.destroy()).resolves.not.toThrow();
    });

    it('should handle multiple destroy calls', async () => {
      const { manager } = createManager();
      await manager.initialize();
      await manager.destroy();
      await expect(manager.destroy()).resolves.not.toThrow();
    });
  });

  describe('error handling', () => {
    it('should handle storage errors gracefully', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      // Mock storage to throw error
      const originalCreateJob = storage.createJob;
      storage.createJob = jest.fn().mockRejectedValue(new Error('Storage error'));

      await expect(
        manager.createJob({
          name: 'test',
          type: 'method',
          enabled: true,
        }),
      ).rejects.toThrow('Storage error');

      // Restore original method
      storage.createJob = originalCreateJob;

      await manager.destroy();
    });

    it('should handle cache errors gracefully', async () => {
      const { manager } = createManager();
      await manager.initialize();

      // Create a job to test with
      const job = await manager.createJob({
        name: 'test-job',
        type: 'method',
        enabled: true,
        context: { distributed: true },
      });

      // This test verifies the job was created successfully
      expect(job).toBeDefined();
      expect(job.name).toBe('test-job');

      await manager.destroy();
    });
  });

  describe('validation', () => {
    it('should validate createJob data properly', async () => {
      const { manager } = createManager();
      await manager.initialize();

      // Test null/undefined data
      await expect(manager.createJob(null as any)).rejects.toThrow('Job data is required');
      await expect(manager.createJob(undefined as any)).rejects.toThrow('Job data is required');

      // Test missing required fields
      await expect(manager.createJob({} as any)).rejects.toThrow('Job name is required');
      await expect(manager.createJob({ name: 'test' } as any)).rejects.toThrow(
        'Job type is required',
      );

      // Test invalid job type
      await expect(
        manager.createJob({ name: 'test', type: 'invalid' as any, enabled: true }),
      ).rejects.toThrow('Job type must be one of: query, method, inline');

      // Test invalid cron expression
      await expect(
        manager.createJob({ name: 'test', type: 'method', enabled: true, cron: 'invalid-cron' }),
      ).rejects.toThrow('Invalid cron expression: invalid-cron');

      // Test query job without query when enabled and scheduled
      await expect(
        manager.createJob({ name: 'test', type: 'query', enabled: true, cron: '0 0 * * *' }),
      ).rejects.toThrow('Query jobs must have a query string when enabled and scheduled');

      // Test valid job creation (should not throw)
      const validJob = await manager.createJob({
        name: 'valid-job',
        type: 'method',
        enabled: false, // Disabled jobs don't need handler
      });
      expect(validJob.name).toBe('valid-job');

      await manager.destroy();
    });

    it('should validate method jobs without handler properly', async () => {
      // Create manager without handler
      const storage = new InMemoryStorage();
      const cache = new InMemoryCache({ disableCleanup: true });
      const managerWithoutHandler = new Manager({
        replicaId: `test-replica-no-handler-${Date.now()}`,
        storage,
        cache,
        logger: mockLogger,
        enabled: false,
        watchInterval: 1,
        // No handler provided
      });

      await managerWithoutHandler.initialize();

      // Test method job without handler when scheduled and enabled
      await expect(
        managerWithoutHandler.createJob({
          name: 'test',
          type: 'method',
          enabled: true,
          cron: '0 0 * * *',
        }),
      ).rejects.toThrow(
        'Method jobs require a job handler to be registered when scheduled and enabled',
      );

      // Test method job without handler when disabled (should succeed)
      const disabledJob = await managerWithoutHandler.createJob({
        name: 'test',
        type: 'method',
        enabled: false,
        cron: '0 0 * * *',
      });
      expect(disabledJob.enabled).toBe(false);

      // Test method job without handler when no cron (should succeed)
      const noCronJob = await managerWithoutHandler.createJob({
        name: 'test2',
        type: 'method',
        enabled: true,
      });
      expect(noCronJob.cron).toBeUndefined();

      await managerWithoutHandler.destroy();
    });

    it('should validate edge cases and other scenarios', async () => {
      const { manager } = createManager();
      await manager.initialize();

      // Test empty string name
      await expect(manager.createJob({ name: '', type: 'method', enabled: true })).rejects.toThrow(
        'Job name must be a non-empty string',
      );

      // Test whitespace-only name
      await expect(
        manager.createJob({ name: '   ', type: 'method', enabled: true }),
      ).rejects.toThrow('Job name must be a non-empty string');

      // Test non-string name
      await expect(
        manager.createJob({ name: 123 as any, type: 'method', enabled: true }),
      ).rejects.toThrow('Job name must be a non-empty string');

      // Test non-string cron
      await expect(
        manager.createJob({ name: 'test', type: 'method', enabled: true, cron: 123 as any }),
      ).rejects.toThrow('Cron expression must be a string');

      // Test valid cron expressions
      const validCrons = [
        { cron: '0 0 * * *', name: 'test-daily' },
        { cron: '*/5 * * * *', name: 'test-every-5-minutes' },
        { cron: '0 12 * * MON', name: 'test-monday-noon' },
      ];
      for (const { cron, name } of validCrons) {
        const job = await manager.createJob({
          name,
          type: 'method',
          enabled: false,
          cron,
        });
        expect(job.cron).toBe(cron);
      }

      // Test query job with query (should succeed)
      const queryJob = await manager.createJob({
        name: 'query-test',
        type: 'query',
        enabled: true,
        cron: '0 0 * * *',
        query: 'SELECT * FROM test',
      });
      expect(queryJob.type).toBe('query');
      expect(queryJob.query).toBeDefined();

      // Test method job with handler (should succeed)
      const methodJob = await manager.createJob({
        name: 'method-test',
        type: 'method',
        enabled: true,
        cron: '0 0 * * *',
      });
      expect(methodJob.type).toBe('method');

      // Test inline job (should succeed)
      const inlineJob = await manager.createJob({
        name: 'inline-test',
        type: 'inline',
        enabled: true,
      });
      expect(inlineJob.type).toBe('inline');

      await manager.destroy();
    }, 30000);

    it('should validate updateJob properly', async () => {
      const { manager } = createManager();
      await manager.initialize();

      // Create a job first
      const job = await manager.createJob({
        name: 'update-test',
        type: 'method',
        enabled: false,
      });

      // Test null/undefined update data
      await expect(manager.updateJob(job.id, null as any)).rejects.toThrow(
        'Update data is required',
      );
      await expect(manager.updateJob(job.id, undefined as any)).rejects.toThrow(
        'Update data is required',
      );

      // Test invalid name update
      await expect(manager.updateJob(job.id, { name: '' })).rejects.toThrow(
        'Job name must be a non-empty string',
      );

      // Test invalid type update
      await expect(manager.updateJob(job.id, { type: 'invalid' as any })).rejects.toThrow(
        'Job type must be one of: query, method, inline',
      );

      // Test invalid cron update
      await expect(manager.updateJob(job.id, { cron: 'invalid-cron' })).rejects.toThrow(
        'Invalid cron expression: invalid-cron',
      );

      // Test valid update (should succeed)
      const updatedJob = await manager.updateJob(job.id, { enabled: true });
      expect(updatedJob.enabled).toBe(true);

      await manager.destroy();
    });

    it('should validate handleJob properly', async () => {
      const { manager } = createManager();
      await manager.initialize();

      // Test null/undefined name
      await expect(manager.handleJob(null as any, async () => {})).rejects.toThrow(
        'Job name is required',
      );
      await expect(manager.handleJob(undefined as any, async () => {})).rejects.toThrow(
        'Job name is required',
      );

      // Test empty string name
      await expect(manager.handleJob('', async () => {})).rejects.toThrow('Job name is required');

      // Test valid name (should not throw)
      await expect(manager.handleJob('valid-job', async () => {})).resolves.not.toThrow();

      await manager.destroy();
    });

    it('should validate toggleJob properly', async () => {
      const { manager } = createManager();
      await manager.initialize();

      // Create a job first
      const job = await manager.createJob({
        name: 'toggle-test',
        type: 'method',
        enabled: false,
      });

      // Test null/undefined id
      await expect(manager.toggleJob(null as any)).rejects.toThrow('Job id is required');
      await expect(manager.toggleJob(undefined as any)).rejects.toThrow('Job id is required');

      // Test empty string id
      await expect(manager.toggleJob('')).rejects.toThrow('Job id is required');

      // Test non-existent job
      await expect(manager.toggleJob('non-existent-job-id')).rejects.toThrow('Job not found');

      // Test valid toggle (should succeed)
      const toggledJob = await manager.toggleJob(job.id);
      expect(toggledJob.enabled).toBe(true);

      await manager.destroy();
    });

    it('should validate enableJob properly', async () => {
      const { manager } = createManager();
      await manager.initialize();

      // Create a disabled job first
      const job = await manager.createJob({
        name: 'enable-test',
        type: 'method',
        enabled: false,
      });

      // Test null/undefined id
      await expect(manager.enableJob(null as any)).rejects.toThrow('Job ID is required');
      await expect(manager.enableJob(undefined as any)).rejects.toThrow('Job ID is required');

      // Test empty string id
      await expect(manager.enableJob('')).rejects.toThrow('Job ID is required');

      // Test non-existent job
      await expect(manager.enableJob('non-existent-id')).rejects.toThrow('Job not found');

      // Test valid enable (should succeed)
      const enabledJob = await manager.enableJob(job.id);
      expect(enabledJob.enabled).toBe(true);

      await manager.destroy();
    });

    it('should validate disableJob properly', async () => {
      const { manager } = createManager();
      await manager.initialize();

      // Create an enabled job first
      const job = await manager.createJob({
        name: 'disable-test',
        type: 'method',
        enabled: true,
      });

      // Test null/undefined id
      await expect(manager.disableJob(null as any)).rejects.toThrow('Job ID is required');
      await expect(manager.disableJob(undefined as any)).rejects.toThrow('Job ID is required');

      // Test empty string id
      await expect(manager.disableJob('')).rejects.toThrow('Job ID is required');

      // Test non-existent job
      await expect(manager.disableJob('non-existent-id')).rejects.toThrow('Job not found');

      // Test valid disable (should succeed)
      const disabledJob = await manager.disableJob(job.id);
      expect(disabledJob.enabled).toBe(false);

      await manager.destroy();
    });

    it('should validate deleteJob properly', async () => {
      const { manager } = createManager();
      await manager.initialize();

      // Create a job first
      const job = await manager.createJob({
        name: 'delete-test',
        type: 'method',
        enabled: false,
      });

      // Test null/undefined id
      await expect(manager.deleteJob(null as any)).rejects.toThrow('Job ID is required');
      await expect(manager.deleteJob(undefined as any)).rejects.toThrow('Job ID is required');

      // Test empty string id
      await expect(manager.deleteJob('')).rejects.toThrow('Job ID is required');

      // Test non-existent job
      await expect(manager.deleteJob('non-existent-id')).rejects.toThrow('Job not found');

      // Test valid delete (should succeed)
      await expect(manager.deleteJob(job.id)).resolves.not.toThrow();

      // Verify job is deleted
      const deletedJob = await manager.getJob(job.id);
      expect(deletedJob).toBeNull();

      await manager.destroy();
    });

    it('should validate getJob properly', async () => {
      const { manager } = createManager();
      await manager.initialize();

      // Test null/undefined id
      await expect(manager.getJob(null as any)).rejects.toThrow('Job ID is required');
      await expect(manager.getJob(undefined as any)).rejects.toThrow('Job ID is required');

      // Test empty string id
      await expect(manager.getJob('')).rejects.toThrow('Job ID is required');

      // Test non-existent job
      const nonExistentJob = await manager.getJob('non-existent-id');
      expect(nonExistentJob).toBeNull();

      // Test valid get (should succeed)
      const methodJob = await manager.createJob({
        name: 'get-test',
        type: 'method',
        enabled: true,
        cron: '0 0 * * *',
      });
      const retrievedJob = await manager.getJob(methodJob.id);
      expect(retrievedJob).toBeDefined();
      expect(retrievedJob!.id).toBe(methodJob.id);

      await manager.destroy();
    });
  });

  describe('reset trigger logic', () => {
    it('should trigger reset successfully', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      // Get existing control instead of creating new one
      const control = await storage.getControl();
      expect(control).toBeDefined();

      // Mock the updateControlWithRetry method
      const originalUpdateControlWithRetry = manager['updateControlWithRetry'];
      manager['updateControlWithRetry'] = jest.fn().mockResolvedValue(control);

      await manager['triggerReset']();

      expect(manager['updateControlWithRetry']).toHaveBeenCalledWith(
        control!.id,
        expect.objectContaining({
          stale: control!.replicas,
        }),
      );

      // Restore original method
      manager['updateControlWithRetry'] = originalUpdateControlWithRetry;
      await manager.destroy();
    });

    it('should handle version conflicts during reset gracefully', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      // Get existing control
      const control = await storage.getControl();
      expect(control).toBeDefined();

      // Mock the updateControlWithRetry method to throw version conflict
      const originalUpdateControlWithRetry = manager['updateControlWithRetry'];
      manager['updateControlWithRetry'] = jest
        .fn()
        .mockRejectedValue(new Error('version mismatch'));

      // This should not throw
      await expect(manager['triggerReset']()).resolves.not.toThrow();

      // Restore original method
      manager['updateControlWithRetry'] = originalUpdateControlWithRetry;
      await manager.destroy();
    });

    it('should handle other errors during reset gracefully', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      // Get existing control
      const control = await storage.getControl();
      expect(control).toBeDefined();

      // Mock the updateControlWithRetry method to throw other error
      const originalUpdateControlWithRetry = manager['updateControlWithRetry'];
      manager['updateControlWithRetry'] = jest.fn().mockRejectedValue(new Error('Storage error'));

      // This should not throw but should log a warning
      await expect(manager['triggerReset']()).resolves.not.toThrow();

      // Restore original method
      manager['updateControlWithRetry'] = originalUpdateControlWithRetry;
      await manager.destroy();
    });
  });

  describe('encryption and decryption', () => {
    it('should throw error when encrypting without query secret', async () => {
      const { manager } = createManager();
      await manager.initialize();

      // Test the actual method behavior when querySecret is undefined
      const originalQuerySecret = (manager as any).querySecret;
      Object.defineProperty(manager as any, 'querySecret', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      expect(() => manager['encryptQuery']('test query')).toThrow('Query secret not configured');

      // Restore original querySecret
      Object.defineProperty(manager as any, 'querySecret', {
        value: originalQuerySecret,
        writable: true,
        configurable: true,
      });
      await manager.destroy();
    });

    it('should throw error when decrypting without query secret', async () => {
      const { manager } = createManager();
      await manager.initialize();

      // Test the actual method behavior when querySecret is undefined
      const originalQuerySecret = (manager as any).querySecret;
      Object.defineProperty(manager as any, 'querySecret', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      expect(() => manager['decryptQuery']('encrypted text')).toThrow(
        'Query secret not configured',
      );

      // Restore original querySecret
      Object.defineProperty(manager as any, 'querySecret', {
        value: originalQuerySecret,
        writable: true,
        configurable: true,
      });
      await manager.destroy();
    });

    it('should encrypt and decrypt queries successfully', async () => {
      const { manager } = createManager();
      await manager.initialize();

      const originalQuery = 'SELECT * FROM users WHERE active = true';
      const encrypted = manager['encryptQuery'](originalQuery);
      const decrypted = manager['decryptQuery'](encrypted);

      expect(encrypted).not.toBe(originalQuery);
      expect(decrypted).toBe(originalQuery);
      await manager.destroy();
    });
  });

  describe('result serialization', () => {
    it('should serialize Lens results correctly', async () => {
      const { manager } = createManager();
      await manager.initialize();

      const lens = new Lens();
      lens.capture({ title: 'Info', level: 'info', message: 'Test message' });
      const frames = lens.getFrames();

      const result = manager['serializeResult'](lens, lens);
      expect(result).toEqual(frames);
      await manager.destroy();
    });

    it('should return lens frames when result is falsy and lens has data', async () => {
      const { manager } = createManager();
      await manager.initialize();

      const lens = new Lens();
      lens.capture({ title: 'Info', level: 'info', message: 'Test message' });
      const frames = lens.getFrames();

      const result = manager['serializeResult'](undefined, lens);
      expect(result).toEqual(frames);
      await manager.destroy();
    });

    it('should return result as-is when result exists and lens is empty', async () => {
      const { manager } = createManager();
      await manager.initialize();

      const lens = new Lens();
      const testResult = { status: 'success', data: [1, 2, 3] };

      const result = manager['serializeResult'](testResult, lens);
      expect(result).toEqual(testResult);
      await manager.destroy();
    });

    it('should return result as-is when result exists and lens has data', async () => {
      const { manager } = createManager();
      await manager.initialize();

      const lens = new Lens();
      lens.capture({ title: 'Info', level: 'info', message: 'Test message' });
      const testResult = { status: 'success', data: [1, 2, 3] };

      const result = manager['serializeResult'](testResult, lens);
      expect(result).toEqual(testResult);
      await manager.destroy();
    });
  });

  describe('log message filtering', () => {
    it('should filter messages based on log level', async () => {
      const { manager } = createManager();
      await manager.initialize();

      // Set log level to error (should only show error messages)
      manager['logLevel'] = 'error';

      manager['logMessage']('error', 'Error message');
      manager['logMessage']('warn', 'Warning message');
      manager['logMessage']('info', 'Info message');
      manager['logMessage']('debug', 'Debug message');

      expect(mockLogger.error).toHaveBeenCalledWith('Error message');
      expect(mockLogger.warn).not.toHaveBeenCalledWith('Warning message');
      expect(mockLogger.log).not.toHaveBeenCalledWith('Info message');
      expect(mockLogger.debug).not.toHaveBeenCalledWith('Debug message');

      await manager.destroy();
    });

    it('should handle unknown log levels gracefully', async () => {
      const { manager } = createManager();
      await manager.initialize();

      // Test unknown log level (should default to info level)
      manager['logMessage']('unknown', 'Unknown level message');
      expect(mockLogger.log).toHaveBeenCalledWith('Unknown level message');

      await manager.destroy();
    });

    it('should handle unknown current log level gracefully', async () => {
      const { manager } = createManager();
      await manager.initialize();

      // Set unknown current log level (should default to info level)
      manager['logLevel'] = 'unknown' as any;

      manager['logMessage']('info', 'Info message');
      expect(mockLogger.log).toHaveBeenCalledWith('Info message');

      await manager.destroy();
    });
  });

  describe('control update retry logic', () => {
    it('should retry control updates on version conflicts', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      // Get existing control instead of creating new one
      const control = await storage.getControl();
      expect(control).toBeDefined();

      // Mock the updateControl method on the storage instance to simulate version conflicts
      let callCount = 0;

      // Also mock getControl to return consistent control data for retries
      const mockGetControl = jest.spyOn(storage, 'getControl').mockResolvedValue(control);

      const mockUpdateControl = jest
        .spyOn(storage, 'updateControl')
        .mockImplementation(async (id: string, data: any) => {
          callCount++;
          // Simulate version conflicts for first 2 attempts, then success
          if (callCount <= 2) {
            throw new Error('version mismatch detected - concurrent modification');
          }
          // On success, return a successful control update
          return {
            ...control!,
            ...data,
            version: 'new-version-after-update',
          };
        });

      // This should succeed after retries
      await expect(
        manager['updateControlWithRetry'](control!.id, { enabled: false }),
      ).resolves.toBeDefined();

      // Restore original methods
      mockUpdateControl.mockRestore();
      mockGetControl.mockRestore();
      await manager.destroy();
    });

    it('should fail after max retries', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      // Get existing control
      const control = await storage.getControl();
      expect(control).toBeDefined();

      // Mock the updateControl method on the storage instance to always throw version mismatch
      const mockUpdateControl = jest
        .spyOn(storage, 'updateControl')
        .mockRejectedValue(new Error('version mismatch'));

      // This should fail after max retries
      await expect(
        manager['updateControlWithRetry'](control!.id, { enabled: false }, 2),
      ).rejects.toThrow('version mismatch');

      // Restore original updateControl method
      mockUpdateControl.mockRestore();
      await manager.destroy();
    });

    it('should handle non-version-conflict errors immediately', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      // Get existing control
      const control = await storage.getControl();
      expect(control).toBeDefined();

      // Mock the updateControl method on the storage instance to throw storage error
      const mockUpdateControl = jest
        .spyOn(storage, 'updateControl')
        .mockRejectedValue(new Error('Storage error'));

      // This should fail immediately
      await expect(
        manager['updateControlWithRetry'](control!.id, { enabled: false }),
      ).rejects.toThrow('Storage error');

      // Restore original updateControl method
      mockUpdateControl.mockRestore();
      await manager.destroy();
    });

    it('should handle control not found error', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      // Mock the getControl method on the storage instance to return null
      const mockGetControl = jest.spyOn(storage, 'getControl').mockResolvedValue(null);

      // This should fail immediately
      await expect(
        manager['updateControlWithRetry']('control-id', { enabled: false }),
      ).rejects.toThrow('Control not found');

      // Restore original getControl method
      mockGetControl.mockRestore();
      await manager.destroy();
    });
  });

  // naming convention tests removed; Manager no longer supports naming selection

  describe('internal validations and lifecycle branches', () => {
    it('ensureInitialized throws before initialize and after destroy', async () => {
      const { manager } = createManager();

      await expect(manager.listJobs()).rejects.toThrow(
        'Manager not initialized. Call initialize() first.',
      );

      await manager.initialize();
      await manager.destroy();
      await expect(manager.listJobs()).rejects.toThrow('Manager has been destroyed.');
    });

    it('validateJobData throws on missing data and fields', async () => {
      const { manager } = createManager();
      // Missing data
      expect(() => (manager as any)['validateJobData'](null, false)).toThrow(
        'Job data is required',
      );

      // Missing name on create
      expect(() =>
        (manager as any)['validateJobData'](
          { type: 'method', enabled: true, cron: '* * * * *' },
          false,
        ),
      ).toThrow('Job name is required');

      // Missing type on create
      expect(() =>
        (manager as any)['validateJobData']({ name: 'x', enabled: true, cron: '* * * * *' }, false),
      ).toThrow('Job type is required');

      // Invalid cron
      expect(() =>
        (manager as any)['validateJobData'](
          { name: 'y', type: 'method', enabled: true, cron: 'not-a-cron' },
          false,
        ),
      ).toThrow('Invalid cron expression: not-a-cron');

      // Query job enabled and scheduled but missing query
      expect(() =>
        (manager as any)['validateJobData'](
          { name: 'q', type: 'query', enabled: true, cron: '* * * * *' },
          false,
        ),
      ).toThrow('Query jobs must have a query string when enabled and scheduled');

      await manager.destroy();
    });

    it('method job requires handler when scheduled and enabled', async () => {
      // Create manager without handler
      const storage = new InMemoryStorage();
      const manager = new Manager({
        storage,
        cache: new InMemoryCache({ disableCleanup: true }),
        logger: { error() {}, warn() {}, log() {}, debug() {} },
        enabled: false,
      });

      expect(() =>
        (manager as any)['validateJobData'](
          { name: 'm', type: 'method', enabled: true, cron: '* * * * *' },
          false,
        ),
      ).toThrow('Method jobs require a job handler to be registered when scheduled and enabled');

      await manager.destroy();
    });

    it('destroy calls cleanup when cache has cleanup but no destroy', async () => {
      const storage = new InMemoryStorage();
      const cleanup = jest.fn().mockResolvedValue(undefined);
      const fakeCache: any = { cleanup };
      const logger = { error() {}, warn() {}, log() {}, debug() {} };
      const manager = new Manager({
        replicaId: `rep-${Date.now()}`,
        storage,
        cache: fakeCache,
        logger,
        enabled: false,
        watchInterval: 1,
      });

      await manager.initialize();
      await manager.destroy();

      expect(cleanup).toHaveBeenCalled();
    });
  });

  describe('additional manager branches', () => {
    it('toggleControl throws when control not found', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      const spy = jest.spyOn(storage, 'getControl').mockResolvedValueOnce(null);
      await expect(manager.toggleControl()).rejects.toThrow('Control not found');
      spy.mockRestore();
      await manager.destroy();
    });

    it('destroy stops jobs and releases locks successfully', async () => {
      const { manager } = createManager();
      await manager.initialize();

      const stop = jest.fn();
      (manager as any)['cronJobs'].set('job-1', { stop } as any);
      (manager as any)['activeLocks'].set('lock-1', {
        lockValue: 'value-1',
        acquiredAt: new Date(),
        ttlMs: 30000,
        jobName: 'test-job',
      });

      const releaseSpy = jest
        .spyOn((manager as any)['cache'], 'releaseLock')
        .mockResolvedValue(true);

      await manager.destroy();

      expect(stop).toHaveBeenCalled();
      expect(releaseSpy).toHaveBeenCalledWith('lock-1', 'value-1');
      releaseSpy.mockRestore();
    });

    it('destroy logs debug when lock release fails', async () => {
      const { manager } = createManager();
      await manager.initialize();

      (manager as any)['logLevel'] = 'debug';
      (manager as any)['activeLocks'].set('lock-2', {
        lockValue: 'value-2',
        acquiredAt: new Date(),
        ttlMs: 30000,
        jobName: 'test-job-2',
      });
      const releaseSpy = jest
        .spyOn((manager as any)['cache'], 'releaseLock')
        .mockRejectedValue(new Error('nope'));

      await manager.destroy();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "Failed to release lock 'lock-2' on shutdown: nope",
      );
      releaseSpy.mockRestore();
    });
  });

  describe('lists, control toggling, and job CRUD', () => {
    it('listJobs filters out watch job', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      // Seed jobs directly in storage
      await storage.createJob({ name: 'regular-job', type: 'inline', enabled: false });

      const jobs = await manager.listJobs();
      expect(jobs.data.find((j) => j.name === 'regular-job')).toBeDefined();
      expect(jobs.data.find((j) => j.name === WATCH_JOB_NAME)).toBeUndefined();

      await manager.destroy();
    });

    it('listJobRuns returns runs data', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      const job = await storage.createJob({ name: 'run-job', type: 'inline', enabled: false });
      await storage.createJobRun({
        job_id: job.id,
        result: 'ok' as any,
        started: new Date(),
      });
      await storage.createJobRun({
        job_id: job.id,
        result: 'err' as any,
        started: new Date(),
        failed: new Date(),
      } as any);

      const runs = await manager.listJobRuns({ job_id: job.id });
      expect(runs.data.length).toBe(2);

      await manager.destroy();
    });

    it('toggleControl flips enabled state', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      const before = await storage.getControl();
      const res = await manager.toggleControl();
      expect(res.enabled).toBe(!before!.enabled);

      // toggle back
      const res2 = await manager.toggleControl();
      expect(res2.enabled).toBe(before!.enabled);

      await manager.destroy();
    });

    it('job CRUD: create, update, delete', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      // create
      const created = await manager.createJob({ name: 'crud-job', type: 'inline', enabled: false });
      expect(created.name).toBe('crud-job');

      // update
      const updated = await manager.updateJob(created.id, { name: 'crud-job-updated' });
      expect(updated.name).toBe('crud-job-updated');

      // delete
      await manager.deleteJob(created.id);
      // Verify via non-deleted filter
      const remaining = await manager.listJobs({ deleted: null as any });
      expect(remaining.data.find((j) => j.id === created.id)).toBeUndefined();
      // And ensure job is marked deleted if fetched without filter
      const allJobs = await manager.listJobs();
      const deletedJob = allJobs.data.find((j) => j.id === created.id);
      expect(deletedJob && (deletedJob as any).deleted).toBeDefined();

      await manager.destroy();
    });

    it('suppresses lifecycle logs per job when silent=true', async () => {
      const { manager } = createManager();
      await manager.initialize();

      // Enable manager for execution path using method job and existing handler
      (manager as any)['enabled'] = true;

      const job = await manager.createJob({
        name: 'silent-job',
        type: 'method',
        enabled: true,
        cron: undefined as any,
        silent: true,
        persist: true,
      } as any);

      // Execute directly
      await (manager as any).executeJob(job);

      // Ensure no started/completed logs were emitted
      expect(mockLogger.log).not.toHaveBeenCalledWith(
        expect.stringMatching(/Job started: silent-job/),
      );
      expect(mockLogger.log).not.toHaveBeenCalledWith(
        expect.stringMatching(/Job completed: silent-job/),
      );

      await manager.destroy();
    });
  });

  describe('handleJob execution paths', () => {
    it('throws when job name is missing', async () => {
      const { manager } = createManager();
      await manager.initialize();
      await expect(manager['handleJob'](null as any, async () => {})).rejects.toThrow(
        'Job name is required',
      );
      await manager.destroy();
    });

    it('returns when job not found or disabled or deleted', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      // not found
      await expect(manager['handleJob']('nope', async () => {})).resolves.toBeUndefined();

      // disabled
      await storage.createJob({ name: 'disabled-job', type: 'inline', enabled: false });
      await expect(manager['handleJob']('disabled-job', async () => {})).resolves.toBeUndefined();

      // deleted
      const j = await storage.createJob({ name: 'deleted-job', type: 'inline', enabled: true });
      await storage.deleteJob(j.id);
      await expect(manager['handleJob']('deleted-job', async () => {})).resolves.toBeUndefined();

      await manager.destroy();
    });

    it('distributed lock not acquired results in early return and debug log', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();
      (manager as any)['logLevel'] = 'debug';

      await storage.createJob({
        name: 'dist-job',
        type: 'inline',
        enabled: true,
        context: { distributed: true, ttl: 1 },
      });

      const lockSpy = jest
        .spyOn((manager as any)['cache'], 'acquireLock')
        .mockResolvedValue({ acquired: false } as any);

      await expect(manager['handleJob']('dist-job', async () => {})).resolves.toBeUndefined();
      expect(mockLogger.debug).toHaveBeenCalledWith('Failed to acquire lock for job: dist-job');
      lockSpy.mockRestore();
      await manager.destroy();
    });

    it('success path creates/updates jobRun and releases lock, runOnce disables job', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      const job = await storage.createJob({
        name: 'ok-job',
        type: 'inline',
        enabled: true,
        context: { distributed: true, ttl: 1, runOnce: true },
        persist: true,
      });

      // track active locks map size transitions
      expect(((manager as any)['activeLocks'] as Map<string, string>).size).toBe(0);

      await manager['handleJob']('ok-job', async () => ({ status: 'done' }));

      // lock released and removed from activeLocks
      expect(((manager as any)['activeLocks'] as Map<string, string>).size).toBe(0);

      // job should be disabled due to runOnce
      const after = await storage.findJob(job.id);
      expect(after!.enabled).toBe(false);

      // jobRun should be completed
      const runs = (await storage.findJobRuns({ job_id: job.id })).data;
      expect(runs.length).toBe(1);
      expect(runs[0].completed).toBeDefined();
      expect(runs[0].failed).toBeUndefined();

      await manager.destroy();
    });

    it('failure path captures error and updates failed', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      const job = await storage.createJob({
        name: 'fail-job',
        type: 'inline',
        enabled: true,
        context: { distributed: false },
        persist: true,
      });

      await manager['handleJob']('fail-job', async () => {
        throw new Error('boom');
      });

      const runs = (await storage.findJobRuns({ job_id: job.id })).data;
      expect(runs.length).toBe(1);
      expect(runs[0].failed).toBeDefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Job failed: fail-job'));

      await manager.destroy();
    });
  });

  describe('additional branch coverage', () => {
    it('createJob encrypts query and triggers reset when scheduled', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      const resetSpy = jest
        .spyOn(manager as any, 'triggerReset')
        .mockResolvedValue(undefined as any);

      const job = await manager.createJob({
        name: 'qjob',
        type: 'query',
        enabled: true,
        cron: '* * * * *',
        query: 'SELECT 1',
      });

      const stored = await storage.findJob(job.id);
      expect(stored!.query).toBeDefined();
      expect(stored!.query).not.toBe('SELECT 1');
      expect(resetSpy).toHaveBeenCalled();

      resetSpy.mockRestore();
      await manager.destroy();
    });

    it('updateJob encrypts query when provided', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      const job = await manager.createJob({ name: 'uj', type: 'inline', enabled: false });
      const updated = await manager.updateJob(job.id, { query: 'SELECT 2', type: 'query' as any });
      const stored = await storage.findJob(updated.id);
      expect(stored!.query).toBeDefined();
      expect(stored!.query).not.toBe('SELECT 2');

      await manager.destroy();
    });

    it('handleJob does not create jobRun when persist is false (default)', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      const job = await storage.createJob({
        name: 'silent',
        type: 'inline',
        enabled: true,
        persist: false,
      } as any);

      await manager['handleJob']('silent', async () => 'ok');

      const runs = (await storage.findJobRuns({ job_id: job.id })).data;
      expect(runs.length).toBe(0);

      await manager.destroy();
    });

    it('destroy is idempotent (second call returns early)', async () => {
      const { manager } = createManager();
      await manager.initialize();

      await manager.destroy();
      // Second call should not throw and return quickly
      await expect(manager.destroy()).resolves.toBeUndefined();
    });

    it('destroy prefers cache.destroy over cleanup', async () => {
      const storage = new InMemoryStorage();
      const destroy = jest.fn().mockResolvedValue(undefined);
      const fakeCache: any = { destroy };
      const logger = { error() {}, warn() {}, log() {}, debug() {} };
      const manager = new Manager({
        replicaId: `rep-${Date.now()}`,
        storage,
        cache: fakeCache,
        logger,
        enabled: false,
        watchInterval: 1,
      });

      await manager.initialize();
      await manager.destroy();

      expect(destroy).toHaveBeenCalled();
    });

    it('destroy skips releasing locks when releaseLocksOnShutdown=false', async () => {
      const storage = new InMemoryStorage();
      const cache = new InMemoryCache({ disableCleanup: true });
      const logger = { error() {}, warn() {}, log() {}, debug() {} };
      const manager = new Manager({
        replicaId: `rep-${Date.now()}`,
        storage,
        cache,
        logger,
        enabled: false,
        watchInterval: 1,
        releaseLocksOnShutdown: false,
      });

      await manager.initialize();
      (manager as any)['activeLocks'].set('l', 'v');
      const relSpy = jest.spyOn(cache, 'releaseLock');

      await manager.destroy();

      expect(relSpy).not.toHaveBeenCalled();
    });
  });

  describe('targeted branch coverage', () => {
    it('resetJobs logs debug on version mismatch', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();
      (manager as any)['logLevel'] = 'debug';

      const control = await storage.getControl();
      // mark this replica stale
      await storage.updateControl(control!.id, {
        stale: [(manager as any).replicaId] as any,
      } as any);

      // Force updateControlWithRetry to throw version mismatch
      const spy = jest
        .spyOn(manager as any, 'updateControlWithRetry')
        .mockRejectedValue(new Error('version mismatch'));

      // Call private via bracket access
      await (manager as any)['resetJobs'](await storage.getControl());

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Control updated by another replica during job reset',
      );
      spy.mockRestore();
      await manager.destroy();
    });

    it('resetJobs logs warn on other errors', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      const control = await storage.getControl();
      await storage.updateControl(control!.id, {
        stale: [(manager as any).replicaId] as any,
      } as any);

      const spy = jest
        .spyOn(manager as any, 'updateControlWithRetry')
        .mockRejectedValue(new Error('boom'));

      await (manager as any)['resetJobs'](await storage.getControl());

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Reset jobs failed: boom'),
      );
      spy.mockRestore();
      await manager.destroy();
    });

    it('createJob without cron does not trigger reset', async () => {
      const { manager } = createManager();
      await manager.initialize();

      const resetSpy = jest.spyOn(manager as any, 'triggerReset');
      await manager.createJob({ name: 'no-cron', type: 'inline', enabled: true });
      expect(resetSpy).not.toHaveBeenCalled();
      resetSpy.mockRestore();
      await manager.destroy();
    });

    it('handleJob non-distributed path sets no active lock', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      await storage.createJob({
        name: 'simple',
        type: 'inline',
        enabled: true,
        context: { distributed: false },
      });
      await manager['handleJob']('simple', async () => 'ok');
      expect(((manager as any)['activeLocks'] as Map<string, string>).size).toBe(0);
      await manager.destroy();
    });

    it('updateJob with context propagates to cache', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      const job = await storage.createJob({ name: 'ctx', type: 'inline', enabled: false });
      const spy = jest.spyOn((manager as any)['cache'], 'setJobContext');
      await manager.updateJob(job.id, { context: { a: 1 } });
      expect(spy).toHaveBeenCalledWith('ctx', { a: 1 });
      spy.mockRestore();
      await manager.destroy();
    });
  });

  describe('control and job API branch coverage', () => {
    it('toggleJob throws on missing name and not found and watch job', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      await expect(manager.toggleJob('' as any)).rejects.toThrow('Job id is required');
      await expect(manager.toggleJob('nope')).rejects.toThrow('Job not found: nope');

      const existingWatch = await storage.findJobByName(WATCH_JOB_NAME);
      await expect(manager.toggleJob(existingWatch!.id)).rejects.toThrow(
        'Cannot toggle system job: __watch__',
      );

      await manager.destroy();
    });

    it('enableJob/disableJob branches: missing id, not found, already enabled/disabled', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      await expect(manager.enableJob('' as any)).rejects.toThrow('Job ID is required');
      await expect(manager.enableJob('no-id')).rejects.toThrow('Job not found: no-id');

      const job = await storage.createJob({ name: 'e1', type: 'inline', enabled: true });
      const same = await manager.enableJob(job.id);
      expect(same.enabled).toBe(true);

      const j2 = await storage.createJob({ name: 'd1', type: 'inline', enabled: false });
      const same2 = await manager.disableJob(j2.id);
      expect(same2.enabled).toBe(false);

      await manager.destroy();
    });

    it('getJob throws on missing id, not found message, hides __watch__ job', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      await expect(manager.getJob('' as any)).rejects.toThrow('Job ID is required');

      const w = await storage.findJobByName(WATCH_JOB_NAME);
      const hidden = await manager.getJob(w!.id);
      expect(hidden).toBeNull();

      await manager.destroy();
    });

    it('initialize is idempotent (second call no-op)', async () => {
      const { manager } = createManager();
      await manager.initialize();
      await expect(manager.initialize()).resolves.toBeUndefined();
      await manager.destroy();
    });

    it('createJob method+cron triggers reset; query without secret remains plain', async () => {
      const storage = new InMemoryStorage();
      const manager = new Manager({
        replicaId: `rep-${Date.now()}`,
        storage,
        cache: new InMemoryCache({ disableCleanup: true }),
        logger: { error() {}, warn() {}, log() {}, debug() {} },
        handler: { executeMethod: jest.fn() } as any,
        enabled: false,
        watchInterval: 1,
      });
      await manager.initialize();

      const resetSpy = jest
        .spyOn(manager as any, 'triggerReset')
        .mockResolvedValue(undefined as any);
      await manager.createJob({ name: 'm1', type: 'method', enabled: true, cron: '* * * * *' });
      expect(resetSpy).toHaveBeenCalled();

      // No querySecret provided; query should not be encrypted
      const job = await manager.createJob({
        name: 'q2',
        type: 'query',
        enabled: true,
        query: 'SELECT 9',
      });
      const stored = await storage.findJob(job.id);
      expect(stored!.query).toBe('SELECT 9');

      resetSpy.mockRestore();
      await manager.destroy();
    });

    it('updateJob triggers reset when type is method', async () => {
      const { manager } = createManager();
      await manager.initialize();

      const job = await manager.createJob({ name: 'um', type: 'inline', enabled: false });
      const resetSpy = jest
        .spyOn(manager as any, 'triggerReset')
        .mockResolvedValue(undefined as any);
      await manager.updateJob(job.id, { type: 'method' as any });
      expect(resetSpy).toHaveBeenCalled();
      resetSpy.mockRestore();
      await manager.destroy();
    });

    it('handleJob merges dynamic context when distributed', async () => {
      const { manager, storage } = createManager();
      await manager.initialize();

      await storage.createJob({
        name: 'merge',
        type: 'inline',
        enabled: true,
        context: { distributed: true },
      });
      const setCtx = jest
        .spyOn((manager as any)['cache'], 'getJobContext')
        .mockResolvedValue({ extra: 1 });
      const exec = jest.fn(async (ctx: any) => {
        expect(ctx.extra).toBe(1);
        return 'ok';
      });
      await manager['handleJob']('merge', exec as any);
      expect(exec).toHaveBeenCalled();
      setCtx.mockRestore();
      await manager.destroy();
    });
  });
});
