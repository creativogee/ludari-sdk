/**
 * Core data types for Ludari
 * These types are database-agnostic and used across all interfaces
 */

// Base entity with common fields
export interface BaseEntity {
  id: string;
  created_at?: Date;
  updated_at?: Date;
}

// Control - Global settings and replica management
export interface Control extends BaseEntity {
  enabled: boolean;
  log_level?: string;
  replicas: string[];
  stale: string[];
  version: string; // Control version for optimistic locking
}

// Job - Job definition and scheduling
export interface Job extends BaseEntity {
  name: string;
  type: 'inline' | 'method' | 'query';
  enabled: boolean;
  context?: Record<string, any>;
  cron?: string;
  query?: string; // Encrypted query for 'query' type jobs
  persist?: boolean; // When true, keep JobRun history (default false)
  silent?: boolean; // Suppress lifecycle logs
  deleted?: Date;
}

// JobRun - Individual job execution record
export interface JobRun extends BaseEntity {
  job_id: string; // Reference to Job
  result?: any;
  started: Date;
  completed?: Date;
  failed?: Date;
}

// Create/Update types
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

// Filter types for querying
export interface JobFilter {
  name?: string;
  type?: 'inline' | 'method' | 'query';
  enabled?: boolean;
  deleted?: null | 'not-null'; // null = only active, 'not-null' = only deleted
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

// Pagination response structure
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

// Job execution context (same as v2)
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
  [key: string]: any; // Allow custom context properties
}

// Frame for logging (same as v2)
export interface Frame {
  title: string;
  message?: string;
  [key: string]: any;
}

// Lens interface for logging (duplicated to avoid circular dependency)
export interface Lens {
  readonly isEmpty: boolean;
  capture(action: Frame): void;
  getFrames(): string;
}

// Import actual Lens class for JobExecution type
import type { Lens as LensClass } from '../core/lens';

// Job execution function type
export type JobExecution = (context?: JobContext, lens?: LensClass) => Promise<any>;

// Lens class is imported separately to avoid conflicts
// export { Lens as LensClass } from '../core/lens'
