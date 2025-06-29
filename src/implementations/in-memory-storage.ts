/**
 * In-memory storage implementation for Nest Cron Manager v3
 * Suitable for testing and single-instance deployments
 */

import { randomUUID } from 'crypto';
import {
  ConflictError,
  NotFoundError,
  Storage,
  StorageError,
} from '../interfaces/storage.interface';
import {
  Control,
  CreateControl,
  CreateJob,
  CreateJobRun,
  Job,
  JobFilter,
  JobRun,
  JobRunFilter,
  PaginatedResponse,
  Pagination,
  UpdateControl,
  UpdateJob,
  UpdateJobRun,
} from '../types/core';

const WATCH_JOB_NAME = '__watch__';

export class InMemoryStorage implements Storage {
  private controls = new Map<string, Control>();
  private jobs = new Map<string, Job>();
  private jobsByName = new Map<string, string>();
  private jobRuns = new Map<string, JobRun>();

  // Simple locking mechanism for thread safety
  private lockPromise: Promise<void> = Promise.resolve();

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
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

  private deepClone<T>(obj: T): T {
    return structuredClone(obj);
  }

  async getControl(): Promise<Control | null> {
    return this.withLock(async () => {
      const controls = Array.from(this.controls.values());
      return controls.length > 0 ? this.deepClone(controls[0]) : null;
    });
  }

  async createControl(data: CreateControl): Promise<Control> {
    return this.withLock(async () => {
      if (this.controls.size > 0) {
        throw new ConflictError('Control record already exists');
      }

      const control: Control = {
        id: randomUUID(),
        created_at: new Date(),
        updated_at: new Date(),
        ...data,
      } as Control;

      this.controls.set(control.id, control);
      return this.deepClone(control);
    });
  }

  async updateControl(id: string, data: UpdateControl): Promise<Control> {
    return this.withLock(async () => {
      const existing = this.controls.get(id);
      if (!existing) {
        throw new NotFoundError('Control', id);
      }

      if (data.version !== undefined && existing.version !== data.version) {
        throw new ConflictError(
          `Control version mismatch. Expected '${existing.version}', got '${data.version}'`,
        );
      }

      const updated: Control = {
        ...existing,
        ...data,
        updated_at: new Date(),
      };

      this.controls.set(id, updated);
      return this.deepClone(updated);
    });
  }

  async findJobs(filter?: JobFilter): Promise<PaginatedResponse<Job>> {
    return this.withLock(async () => {
      let jobs = Array.from(this.jobs.values());

      // Always exclude __watch__ jobs
      jobs = jobs.filter((job) => job.name !== WATCH_JOB_NAME);

      if (filter) {
        jobs = jobs.filter((job) => {
          if (filter.name && job.name !== filter.name) return false;
          if (filter.type && job.type !== filter.type) return false;
          if (filter.enabled !== undefined && job.enabled !== filter.enabled) return false;
          if (filter.deleted === 'not-null' && !job.deleted) return false;
          if (filter.deleted === null && job.deleted) return false;
          return true;
        });
      }

      const total = jobs.length;
      const page = filter?.page || 1;
      const pageSize = filter?.page_size || total;
      const lastPage = Math.ceil(total / pageSize);
      const currentPage = Math.min(Math.max(1, page), lastPage);
      const startIndex = (currentPage - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedJobs = jobs.slice(startIndex, endIndex);

      const pagination: Pagination = {
        total,
        last_page: lastPage,
        current_page: currentPage,
        next_page: currentPage < lastPage ? currentPage + 1 : null,
        previous_page: currentPage > 1 ? currentPage - 1 : null,
        page_size: pageSize,
      };

      return {
        data: this.deepClone(paginatedJobs),
        pagination,
      };
    });
  }

  async findJob(id: string): Promise<Job | null> {
    return this.withLock(async () => {
      const job = this.jobs.get(id) || null;
      // Exclude deleted jobs by default
      if (job && job.deleted) {
        return null;
      }
      return job ? this.deepClone(job) : null;
    });
  }

  async findJobByName(name: string): Promise<Job | null> {
    return this.withLock(async () => {
      const id = this.jobsByName.get(name);
      if (!id) return null;
      const job = this.jobs.get(id) || null;
      // Exclude deleted jobs by default
      if (job && job.deleted) {
        return null;
      }
      return job ? this.deepClone(job) : null;
    });
  }

  async createJob(data: CreateJob): Promise<Job> {
    return this.withLock(async () => {
      if (this.jobsByName.has(data.name)) {
        throw new ConflictError(`Job with name '${data.name}' already exists`);
      }

      const job: Job = {
        id: randomUUID(),
        created_at: new Date(),
        updated_at: new Date(),
        deleted: undefined,
        ...data,
      } as Job;

      this.jobs.set(job.id, job);
      this.jobsByName.set(job.name, job.id);
      return this.deepClone(job);
    });
  }

  async updateJob(id: string, data: UpdateJob): Promise<Job> {
    return this.withLock(async () => {
      const existing = this.jobs.get(id);
      if (!existing) {
        throw new NotFoundError('Job', id);
      }

      if (data.name && data.name !== existing.name && this.jobsByName.has(data.name)) {
        throw new ConflictError(`Job with name '${data.name}' already exists`);
      }

      const updated: Job = {
        ...existing,
        ...data,
        updated_at: new Date(),
      } as Job;

      if (data.name && data.name !== existing.name) {
        this.jobsByName.delete(existing.name);
        this.jobsByName.set(updated.name, id);
      }

      this.jobs.set(id, updated);
      return this.deepClone(updated);
    });
  }

  async deleteJob(id: string): Promise<void> {
    return this.withLock(async () => {
      const existing = this.jobs.get(id);
      if (!existing) {
        throw new NotFoundError('Job', id);
      }

      const updated: Job = {
        ...existing,
        deleted: new Date(),
        updated_at: new Date(),
      } as Job;

      this.jobs.set(id, updated);
    });
  }

  async createJobRun(data: CreateJobRun): Promise<JobRun> {
    return this.withLock(async () => {
      if (!this.jobs.has(data.job_id)) {
        throw new StorageError(
          `Cannot create job run: Job '${data.job_id}' not found`,
          'INVALID_REFERENCE',
        );
      }

      const jobRun: JobRun = {
        id: randomUUID(),
        created_at: new Date(),
        updated_at: new Date(),
        completed: undefined,
        failed: undefined,
        ...data,
      };

      this.jobRuns.set(jobRun.id, jobRun);
      return this.deepClone(jobRun);
    });
  }

  async updateJobRun(id: string, data: UpdateJobRun): Promise<JobRun> {
    return this.withLock(async () => {
      const existing = this.jobRuns.get(id);
      if (!existing) {
        throw new NotFoundError('JobRun', id);
      }

      const updated: JobRun = {
        ...existing,
        ...data,
        updated_at: new Date(),
      } as JobRun;

      this.jobRuns.set(id, updated);
      return this.deepClone(updated);
    });
  }

  async findJobRuns(filter?: JobRunFilter): Promise<PaginatedResponse<JobRun>> {
    return this.withLock(async () => {
      let runs = Array.from(this.jobRuns.values());
      if (filter) {
        runs = runs.filter((jobRun) => {
          if (filter.job_id && jobRun.job_id !== filter.job_id) return false;
          if (filter.started_after && jobRun.started <= filter.started_after) return false;
          if (filter.started_before && jobRun.started >= filter.started_before) return false;
          if (filter.status === 'completed' && !jobRun.completed) return false;
          if (filter.status === 'failed' && !jobRun.failed) return false;
          if (filter.status === 'running' && (jobRun.completed || jobRun.failed)) return false;
          return true;
        });
      }

      const total = runs.length;
      const page = filter?.page || 1;
      const pageSize = filter?.page_size || total;
      const lastPage = Math.ceil(total / pageSize);
      const currentPage = Math.min(Math.max(1, page), lastPage);
      const startIndex = (currentPage - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const paginatedRuns = runs.slice(startIndex, endIndex);

      const pagination: Pagination = {
        total,
        last_page: lastPage,
        current_page: currentPage,
        next_page: currentPage < lastPage ? currentPage + 1 : null,
        previous_page: currentPage > 1 ? currentPage - 1 : null,
        page_size: pageSize,
      };

      return {
        data: this.deepClone(paginatedRuns),
        pagination,
      };
    });
  }

  async executeQuery(sql: string): Promise<any> {
    throw new StorageError('executeQuery not supported by InMemoryStorage', 'NOT_SUPPORTED');
  }

  async clear(): Promise<void> {
    return this.withLock(async () => {
      this.controls.clear();
      this.jobs.clear();
      this.jobsByName.clear();
      this.jobRuns.clear();
    });
  }
}
