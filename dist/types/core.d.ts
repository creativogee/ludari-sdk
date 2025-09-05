/**
 * Core data types for Ludari
 * These types are database-agnostic and used across all interfaces
 */
export interface BaseEntity {
    id: string;
    created_at?: Date;
    updated_at?: Date;
}
export interface Control extends BaseEntity {
    enabled: boolean;
    log_level?: string;
    replicas: string[];
    stale: string[];
    version: string;
}
export interface Job extends BaseEntity {
    name: string;
    type: 'inline' | 'method' | 'query';
    enabled: boolean;
    context?: Record<string, any>;
    cron?: string;
    query?: string;
    persist?: boolean;
    silent?: boolean;
    deleted?: Date;
}
export interface JobRun extends BaseEntity {
    job_id: string;
    result?: any;
    started: Date;
    completed?: Date;
    failed?: Date;
}
export interface CreateControl {
    enabled: boolean;
    log_level?: string;
    replicas: string[];
    stale: string[];
    version: string;
}
export interface UpdateControl {
    enabled?: boolean;
    log_level?: string;
    replicas?: string[];
    stale?: string[];
    version?: string;
}
export interface CreateJob {
    name: string;
    type: 'inline' | 'method' | 'query';
    enabled: boolean;
    context?: Record<string, any>;
    cron?: string;
    query?: string;
    persist?: boolean;
    silent?: boolean;
}
export interface UpdateJob {
    name?: string;
    type?: 'inline' | 'method' | 'query';
    enabled?: boolean;
    context?: Record<string, any>;
    cron?: string;
    query?: string;
    persist?: boolean;
    silent?: boolean;
    deleted?: Date;
}
export interface CreateJobRun {
    job_id: string;
    result?: any;
    started: Date;
}
export interface UpdateJobRun {
    result?: any;
    completed?: Date;
    failed?: Date;
}
export interface JobFilter {
    name?: string;
    type?: 'inline' | 'method' | 'query';
    enabled?: boolean;
    deleted?: null | 'not-null';
    page?: number;
    page_size?: number;
}
export interface JobRunFilter {
    job_id?: string;
    started_after?: Date;
    started_before?: Date;
    status?: 'completed' | 'failed' | 'running';
    page?: number;
    page_size?: number;
}
export interface Pagination {
    total: number;
    last_page: number;
    current_page: number;
    next_page: number | null;
    previous_page: number | null;
    page_size: number;
}
export interface PaginatedResponse<T> {
    data: T[];
    pagination: Pagination;
}
export interface JobContext {
    distributed?: boolean;
    ttl?: number;
    batch?: number;
    batchSize?: number;
    replicas?: number;
    concurrent?: boolean;
    maxRetries?: number;
    retryDelay?: number;
    runOnce?: boolean;
    [key: string]: any;
}
export interface Frame {
    title: string;
    message?: string;
    [key: string]: any;
}
export interface Lens {
    readonly isEmpty: boolean;
    capture(action: Frame): void;
    getFrames(): string;
}
import type { Lens as LensClass } from '../core/lens';
export type JobExecution = (context?: JobContext, lens?: LensClass) => Promise<any>;
