/**
 * Storage interface for Nest Cron Manager v3
 * Provides database-agnostic persistence operations
 */
import { Control, CreateControl, CreateJob, CreateJobRun, Job, JobFilter, JobRun, JobRunFilter, PaginatedResponse, UpdateControl, UpdateJob, UpdateJobRun } from '../types/core';
export declare class StorageError extends Error {
    readonly code: string;
    readonly cause?: Error | undefined;
    constructor(message: string, code: string, cause?: Error | undefined);
}
export declare class NotFoundError extends StorageError {
    constructor(entity: string, id: string, cause?: Error);
}
export declare class ConflictError extends StorageError {
    constructor(message: string, cause?: Error);
}
export interface Storage {
    getControl(): Promise<Control | null>;
    createControl(data: CreateControl): Promise<Control>;
    updateControl(id: string, data: UpdateControl): Promise<Control>;
    findJobs(filter?: JobFilter): Promise<PaginatedResponse<Job>>;
    findJob(id: string): Promise<Job | null>;
    findJobByName(name: string): Promise<Job | null>;
    createJob(data: CreateJob): Promise<Job>;
    updateJob(id: string, data: UpdateJob): Promise<Job>;
    deleteJob(id: string): Promise<void>;
    createJobRun(data: CreateJobRun): Promise<JobRun>;
    updateJobRun(id: string, data: UpdateJobRun): Promise<JobRun>;
    findJobRuns(filter?: JobRunFilter): Promise<PaginatedResponse<JobRun>>;
    executeQuery?(sql: string): Promise<any>;
}
