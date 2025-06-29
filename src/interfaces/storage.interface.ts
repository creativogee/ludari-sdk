/**
 * Storage interface for Nest Cron Manager v3
 * Provides database-agnostic persistence operations
 */

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
  UpdateControl,
  UpdateJob,
  UpdateJobRun,
} from '../types/core';

export class StorageError extends Error {
  constructor(message: string, public readonly code: string, public readonly cause?: Error) {
    super(message);
    this.name = 'StorageError';
  }
}

export class NotFoundError extends StorageError {
  constructor(entity: string, id: string, cause?: Error) {
    super(`${entity} with id '${id}' not found`, 'NOT_FOUND', cause);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends StorageError {
  constructor(message: string, cause?: Error) {
    super(message, 'CONFLICT', cause);
    this.name = 'ConflictError';
  }
}

export interface Storage {
  // Control operations
  getControl(): Promise<Control | null>;
  createControl(data: CreateControl): Promise<Control>;
  updateControl(id: string, data: UpdateControl): Promise<Control>;

  // Job operations
  findJobs(filter?: JobFilter): Promise<PaginatedResponse<Job>>;
  findJob(id: string): Promise<Job | null>;
  findJobByName(name: string): Promise<Job | null>;
  createJob(data: CreateJob): Promise<Job>;
  updateJob(id: string, data: UpdateJob): Promise<Job>;
  deleteJob(id: string): Promise<void>;

  // JobRun operations
  createJobRun(data: CreateJobRun): Promise<JobRun>;
  updateJobRun(id: string, data: UpdateJobRun): Promise<JobRun>;
  findJobRuns(filter?: JobRunFilter): Promise<PaginatedResponse<JobRun>>;

  // Optional query support
  executeQuery?(sql: string): Promise<any>;
}
