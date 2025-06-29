import {
  CreateControl,
  CreateJob,
  CreateJobRun,
  UpdateControl,
  UpdateJob,
  UpdateJobRun,
} from '../types/core';
import { InMemoryStorage } from './in-memory-storage';

describe('InMemoryStorage', () => {
  let storage: InMemoryStorage;

  describe('additional branch coverage - jobs', () => {
    it('filters by deleted flag and paginates', async () => {
      const storage = new InMemoryStorage();
      // create non-deleted
      await storage.createJob({ name: 'a1', type: 'inline', enabled: true });
      // create deleted
      const j2 = await storage.createJob({ name: 'a2', type: 'inline', enabled: false });
      await storage.deleteJob(j2.id);

      // deleted=null should exclude deleted
      const page1 = await storage.findJobs({ deleted: null, page: 10, page_size: 1 });
      expect(page1.pagination.current_page).toBe(1);
      expect(page1.pagination.last_page).toBe(1);
      expect(page1.data.length).toBe(1);
      expect(page1.data[0].name).toBe('a1');

      // deleted='not-null' should include only deleted
      const onlyDeleted = await storage.findJobs({ deleted: 'not-null' });
      expect(onlyDeleted.data.length).toBe(1);
      expect(onlyDeleted.data[0].name).toBe('a2');

      // name/type/enabled combined filter
      const filtered = await storage.findJobs({ name: 'a1', type: 'inline', enabled: true });
      expect(filtered.data.length).toBe(1);
      expect(filtered.data[0].name).toBe('a1');
    });
  });

  describe('additional branch coverage - job runs', () => {
    it('filters by status and time windows and paginates', async () => {
      const storage = new InMemoryStorage();
      const job = await storage.createJob({ name: 'r1', type: 'inline', enabled: true });

      const now = new Date();
      const past = new Date(now.getTime() - 60_000);
      const future = new Date(now.getTime() + 60_000);

      const runRunning = await storage.createJobRun({ job_id: job.id, started: now } as any);
      await storage.createJobRun({ job_id: job.id, started: past, completed: now } as any);
      await storage.createJobRun({ job_id: job.id, started: past, failed: now } as any);

      const running = await storage.findJobRuns({ job_id: job.id, status: 'running' });
      expect(running.data.find((r) => r.id === runRunning.id)).toBeDefined();

      const completed = await storage.findJobRuns({ job_id: job.id, status: 'completed' });
      expect(completed.data.every((r) => r.completed)).toBe(true);

      const failed = await storage.findJobRuns({ job_id: job.id, status: 'failed' });
      expect(failed.data.every((r) => r.failed)).toBe(true);

      // time filters
      const afterNow = await storage.findJobRuns({ job_id: job.id, started_after: future });
      expect(afterNow.data.length).toBe(0);

      const beforePast = await storage.findJobRuns({ job_id: job.id, started_before: past });
      expect(beforePast.data.length).toBe(0);

      // pagination with page_size 1
      const paged = await storage.findJobRuns({ job_id: job.id, page: 1, page_size: 1 });
      expect(paged.pagination.last_page).toBeGreaterThanOrEqual(3);
      expect(paged.data.length).toBe(1);
    });
  });

  describe('additional branch coverage - control and error paths', () => {
    it('updateControl not found throws NotFoundError', async () => {
      const storage = new InMemoryStorage();
      await expect(storage.updateControl('missing', { enabled: false } as any)).rejects.toThrow(
        'Control',
      );
    });

    it('createJob duplicate name throws ConflictError', async () => {
      const storage = new InMemoryStorage();
      await storage.createJob({ name: 'dup', type: 'inline', enabled: true });
      await expect(
        storage.createJob({ name: 'dup', type: 'inline', enabled: true }),
      ).rejects.toThrow("Job with name 'dup' already exists");
    });
    it('createControl conflict and updateControl version mismatch', async () => {
      const storage = new InMemoryStorage();
      const control = await storage.createControl({
        replicas: [],
        enabled: true,
        stale: [],
        version: 1,
      } as any);
      await expect(
        storage.createControl({ replicas: [], enabled: true, stale: [], version: 1 } as any),
      ).rejects.toThrow('Control record already exists');

      await expect(
        storage.updateControl(control.id, { version: 999, enabled: false } as any),
      ).rejects.toThrow('Control version mismatch');
    });

    it('updateJob not found and name conflict on rename', async () => {
      const storage = new InMemoryStorage();
      await expect(storage.updateJob('missing', { name: 'x' })).rejects.toThrow('Job');

      const j1 = await storage.createJob({ name: 'n1', type: 'inline', enabled: true });
      const j2 = await storage.createJob({ name: 'n2', type: 'inline', enabled: true });
      await expect(storage.updateJob(j2.id, { name: 'n1' })).rejects.toThrow(
        "Job with name 'n1' already exists",
      );
    });

    it('deleteJob not found', async () => {
      const storage = new InMemoryStorage();
      await expect(storage.deleteJob('missing')).rejects.toThrow('Job');
    });

    it('createJobRun invalid reference and updateJobRun not found', async () => {
      const storage = new InMemoryStorage();
      await expect(
        storage.createJobRun({ job_id: 'missing', started: new Date() } as any),
      ).rejects.toThrow("Job 'missing' not found");

      const j = await storage.createJob({ name: 'rnf', type: 'inline', enabled: true });
      const run = await storage.createJobRun({ job_id: j.id, started: new Date() } as any);
      await expect(storage.updateJobRun('nope', { completed: new Date() } as any)).rejects.toThrow(
        'JobRun',
      );
      const updated = await storage.updateJobRun(run.id, { completed: new Date() } as any);
      expect(updated.completed).toBeDefined();
    });

    it('executeQuery not supported', async () => {
      const storage = new InMemoryStorage();
      await expect(storage.executeQuery('SELECT 1')).rejects.toThrow('not supported');
    });
  });
  beforeEach(() => {
    storage = new InMemoryStorage();
  });

  afterEach(async () => {
    // Clean up storage data
    await storage.clear();
  });

  describe('Control operations', () => {
    const mockControl: CreateControl = {
      enabled: true,
      log_level: 'info' as any,
      replicas: ['replica1'],
      stale: [],
      version: '1.0.0',
    };

    it('should create control entity', async () => {
      const control = await storage.createControl(mockControl);

      expect(control).toMatchObject(mockControl);
      expect(control.id).toBeDefined();
      expect((control as any).created_at).toBeDefined();
      expect((control as any).updated_at).toBeDefined();
    });

    it('should get control', async () => {
      await storage.createControl(mockControl);
      const found = await storage.getControl();

      expect(found).toMatchObject(mockControl);
      expect(found!.id).toBeDefined();
    });

    it('should return null for non-existent control', async () => {
      const found = await storage.getControl();
      expect(found).toBeNull();
    });

    it('should update control entity', async () => {
      const created = await storage.createControl(mockControl);
      const update: UpdateControl = {
        enabled: false,
        log_level: 'debug' as any,
        version: created.version, // Must match for optimistic locking
      };

      const updated = await storage.updateControl(created.id, update);

      expect(updated).toMatchObject({
        ...created,
        enabled: false,
        log_level: 'debug' as any,
      });
      expect((updated as any).updated_at!.getTime()).toBeGreaterThanOrEqual(
        (created as any).updated_at!.getTime(),
      );
    });

    it('should throw conflict error for version mismatch', async () => {
      const created = await storage.createControl(mockControl);
      const update: UpdateControl = {
        enabled: false,
        version: 'wrong-version', // Wrong version
      };

      await expect(storage.updateControl(created.id, update)).rejects.toThrow(
        'Control version mismatch',
      );
    });
  });

  describe('Job operations', () => {
    const mockJob: CreateJob = {
      name: 'test-job',
      type: 'query',
      enabled: true,
      context: { key: 'value' },
      cron: '0 0 * * *',
      query: 'SELECT * FROM users',
      persist: true,
    };

    it('should create job entity', async () => {
      const job = await storage.createJob(mockJob);

      expect(job).toMatchObject(mockJob);
      expect(job.id).toBeDefined();
      expect((job as any).created_at).toBeDefined();
      expect((job as any).updated_at).toBeDefined();
    });

    it('should find job by id', async () => {
      const created = await storage.createJob(mockJob);
      const found = await storage.findJob(created.id);

      expect(found).toEqual(created);
    });

    it('should find jobs with filters', async () => {
      await storage.createJob({ ...mockJob, name: 'job1', type: 'query', enabled: true });
      await storage.createJob({ ...mockJob, name: 'job2', type: 'method', enabled: false });
      await storage.createJob({ ...mockJob, name: 'job3', type: 'query', enabled: true });

      const queryJobs = await storage.findJobs({ type: 'query' });
      expect(queryJobs.data).toHaveLength(2);
      expect(queryJobs.data.every((job) => job.type === 'query')).toBe(true);

      const enabledJobs = await storage.findJobs({ enabled: true });
      expect(enabledJobs.data).toHaveLength(2);
      expect(enabledJobs.data.every((job) => job.enabled === true)).toBe(true);

      const namedJob = await storage.findJobs({ name: 'job2' });
      expect(namedJob.data).toHaveLength(1);
      expect(namedJob.data[0].name).toBe('job2');
    });

    it('should support pagination', async () => {
      // Create 5 jobs
      for (let i = 1; i <= 5; i++) {
        await storage.createJob({ ...mockJob, name: `job${i}` });
      }

      // Test first page
      const firstPage = await storage.findJobs({ page: 1, page_size: 2 });
      expect(firstPage.data).toHaveLength(2);
      expect(firstPage.pagination.total).toBe(5);
      expect(firstPage.pagination.current_page).toBe(1);
      expect(firstPage.pagination.last_page).toBe(3);
      expect(firstPage.pagination.next_page).toBe(2);
      expect(firstPage.pagination.previous_page).toBe(null);

      // Test second page
      const secondPage = await storage.findJobs({ page: 2, page_size: 2 });
      expect(secondPage.data).toHaveLength(2);
      expect(secondPage.pagination.current_page).toBe(2);
      expect(secondPage.pagination.next_page).toBe(3);
      expect(secondPage.pagination.previous_page).toBe(1);

      // Test last page
      const lastPage = await storage.findJobs({ page: 3, page_size: 2 });
      expect(lastPage.data).toHaveLength(1);
      expect(lastPage.pagination.current_page).toBe(3);
      expect(lastPage.pagination.next_page).toBe(null);
      expect(lastPage.pagination.previous_page).toBe(2);
    });

    it('should find jobs excluding deleted ones by default', async () => {
      const job1 = await storage.createJob({ ...mockJob, name: 'active' });
      const job2 = await storage.createJob({ ...mockJob, name: 'deleted' });

      await storage.updateJob(job2.id, { deleted: new Date() });

      // Find active jobs (deleted: null)
      const activeJobs = await storage.findJobs({ deleted: null });
      expect(activeJobs.data).toHaveLength(1);
      expect(activeJobs.data[0].name).toBe('active');

      // Find deleted jobs (deleted: 'not-null')
      const deletedJobs = await storage.findJobs({ deleted: 'not-null' });
      expect(deletedJobs.data).toHaveLength(1);
      expect(deletedJobs.data[0].id).toBe(job2.id);
      expect(deletedJobs.data[0].deleted).toBeDefined();

      // Verify total count
      const allJobs = await storage.findJobs();
      expect(allJobs.data).toHaveLength(2);
    });

    it('should update job entity', async () => {
      const created = await storage.createJob(mockJob);
      const update: UpdateJob = {
        name: 'updated-job',
        enabled: false,
        cron: '0 12 * * *',
      };

      const updated = await storage.updateJob(created.id, update);

      expect(updated).toMatchObject({
        ...created,
        ...update,
      });
    });

    it('should soft delete job entity', async () => {
      const created = await storage.createJob(mockJob);

      await storage.deleteJob(created.id);

      // findJob should not return deleted jobs by default
      const found = await storage.findJob(created.id);
      expect(found).toBeNull();

      // But we can find deleted jobs using findJobs with deleted filter
      const deletedJobs = await storage.findJobs({ deleted: 'not-null' });
      expect(deletedJobs.data).toHaveLength(1);
      expect(deletedJobs.data[0].id).toBe(created.id);
      expect(deletedJobs.data[0].deleted).toBeDefined();
    });
  });

  describe('JobRun operations', () => {
    let jobId: string;

    beforeEach(async () => {
      const job = await storage.createJob({
        name: 'test-job',
        type: 'query',
        enabled: true,
      });
      jobId = job.id;
    });

    const createMockJobRun = (): CreateJobRun => ({
      job_id: jobId as any,
      started: new Date(),
      result: { success: true },
    });

    it('should create job run entity', async () => {
      const mockJobRun = createMockJobRun();
      const jobRun = await storage.createJobRun(mockJobRun);

      expect(jobRun).toMatchObject(mockJobRun as any);
      expect(jobRun.id).toBeDefined();
      expect((jobRun as any).created_at).toBeDefined();
      expect((jobRun as any).updated_at).toBeDefined();
    });

    it('should find job run by id', async () => {
      const created = await storage.createJobRun(createMockJobRun());
      const jobRuns = await storage.findJobRuns({ job_id: jobId } as any);
      const found = jobRuns.data.find((j) => j.id === created.id);

      expect(found).toEqual(created);
    });

    it('should find job runs with filters', async () => {
      const startTime = new Date();
      await storage.createJobRun({ ...createMockJobRun(), started: startTime });
      await storage.createJobRun({
        ...createMockJobRun(),
        started: new Date(startTime.getTime() + 1000),
      });

      const jobRuns = await storage.findJobRuns({ job_id: jobId } as any);
      expect(jobRuns.data).toHaveLength(2);
    });

    it('should support pagination for job runs', async () => {
      // Create 5 job runs
      for (let i = 1; i <= 5; i++) {
        await storage.createJobRun({
          ...createMockJobRun(),
          started: new Date(Date.now() + i * 1000),
        });
      }

      // Test first page
      const firstPage = await storage.findJobRuns({ page: 1, page_size: 2 });
      expect(firstPage.data).toHaveLength(2);
      expect(firstPage.pagination.total).toBe(5);
      expect(firstPage.pagination.current_page).toBe(1);
      expect(firstPage.pagination.last_page).toBe(3);
      expect(firstPage.pagination.next_page).toBe(2);
      expect(firstPage.pagination.previous_page).toBe(null);

      // Test second page
      const secondPage = await storage.findJobRuns({ page: 2, page_size: 2 });
      expect(secondPage.data).toHaveLength(2);
      expect(secondPage.pagination.current_page).toBe(2);
      expect(secondPage.pagination.next_page).toBe(3);
      expect(secondPage.pagination.previous_page).toBe(1);

      // Test last page
      const lastPage = await storage.findJobRuns({ page: 3, page_size: 2 });
      expect(lastPage.data).toHaveLength(1);
      expect(lastPage.pagination.current_page).toBe(3);
      expect(lastPage.pagination.next_page).toBe(null);
      expect(lastPage.pagination.previous_page).toBe(2);
    });

    it('should update job run entity', async () => {
      const created = await storage.createJobRun(createMockJobRun());
      const update: UpdateJobRun = {
        completed: new Date(),
        result: { success: true, completed: true },
      };

      const updated = await storage.updateJobRun(created.id, update);

      expect(updated).toMatchObject({
        ...created,
        ...update,
      });
    });
  });

  describe('concurrent operations', () => {
    it('should handle concurrent control updates safely', async () => {
      const mockControl: CreateControl = {
        enabled: true,
        log_level: 'info' as any,
        replicas: ['replica1'],
        stale: [],
        version: '1.0.0',
      };

      const control = await storage.createControl(mockControl);

      // Simulate concurrent updates
      const updatePromises = Array.from({ length: 5 }, (_, i) =>
        storage.updateControl(control.id, {
          log_level: `level-${i}` as any,
          version: control.version,
        }),
      );

      const results = await Promise.allSettled(updatePromises);
      const successfulUpdates = results.filter((r) => r.status === 'fulfilled');

      // All should succeed since they use the same version
      expect(successfulUpdates.length).toBe(5);

      // Verify the final state
      const finalControl = await storage.getControl();
      expect(finalControl).toBeDefined();
      expect((finalControl as any)!.log_level).toMatch(/^level-\d+$/);
    });
  });

  describe('extra coverage', () => {
    it('excludes job runs for different job_id', async () => {
      const storage = new InMemoryStorage();
      const j1 = await storage.createJob({ name: 'a', type: 'inline', enabled: true });
      const j2 = await storage.createJob({ name: 'b', type: 'inline', enabled: true });
      await storage.createJobRun({ job_id: j1.id, started: new Date() } as any);
      await storage.createJobRun({ job_id: j2.id, started: new Date() } as any);
      const onlyJ1 = await storage.findJobRuns({ job_id: j1.id });
      expect(onlyJ1.data.every((r) => r.job_id === j1.id)).toBe(true);
    });

    it('findJobByName returns null when name missing, deleted, or stale id', async () => {
      const storage = new InMemoryStorage();
      // missing
      expect(await storage.findJobByName('none')).toBeNull();
      // create and delete
      const j = await storage.createJob({ name: 'n', type: 'inline', enabled: true });
      await storage.updateJob(j.id, { deleted: new Date() } as any);
      expect(await storage.findJobByName('n')).toBeNull();
      // stale id mapping
      (storage as any)['jobsByName'].set('stale', 'no-such-id');
      expect(await storage.findJobByName('stale')).toBeNull();
    });
  });
});
