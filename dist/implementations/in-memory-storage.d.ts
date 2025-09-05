/**
 * In-memory storage implementation for Nest Cron Manager v3
 * Suitable for testing and single-instance deployments
 */
import { Storage } from '../interfaces/storage.interface';
import { Control, CreateControl, CreateJob, CreateJobRun, Job, JobFilter, JobRun, JobRunFilter, PaginatedResponse, UpdateControl, UpdateJob, UpdateJobRun } from '../types/core';
export declare class InMemoryStorage implements Storage {
    private controls;
    private jobs;
    private jobsByName;
    private jobRuns;
    private lockPromise;
    private withLock;
    private deepClone;
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
    executeQuery(sql: string): Promise<any>;
    clear(): Promise<void>;
}
