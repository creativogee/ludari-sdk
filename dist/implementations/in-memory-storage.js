"use strict";
/**
 * In-memory storage implementation for Nest Cron Manager v3
 * Suitable for testing and single-instance deployments
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryStorage = void 0;
const crypto_1 = require("crypto");
const storage_interface_1 = require("../interfaces/storage.interface");
const WATCH_JOB_NAME = '__watch__';
class InMemoryStorage {
    constructor() {
        this.controls = new Map();
        this.jobs = new Map();
        this.jobsByName = new Map();
        this.jobRuns = new Map();
        // Simple locking mechanism for thread safety
        this.lockPromise = Promise.resolve();
    }
    async withLock(operation) {
        const currentLock = this.lockPromise;
        let resolveLock;
        this.lockPromise = new Promise((resolve) => {
            resolveLock = resolve;
        });
        try {
            await currentLock;
            return await operation();
        }
        finally {
            resolveLock();
        }
    }
    deepClone(obj) {
        return structuredClone(obj);
    }
    async getControl() {
        return this.withLock(async () => {
            const controls = Array.from(this.controls.values());
            return controls.length > 0 ? this.deepClone(controls[0]) : null;
        });
    }
    async createControl(data) {
        return this.withLock(async () => {
            if (this.controls.size > 0) {
                throw new storage_interface_1.ConflictError('Control record already exists');
            }
            const control = {
                id: (0, crypto_1.randomUUID)(),
                created_at: new Date(),
                updated_at: new Date(),
                ...data,
            };
            this.controls.set(control.id, control);
            return this.deepClone(control);
        });
    }
    async updateControl(id, data) {
        return this.withLock(async () => {
            const existing = this.controls.get(id);
            if (!existing) {
                throw new storage_interface_1.NotFoundError('Control', id);
            }
            if (data.version !== undefined && existing.version !== data.version) {
                throw new storage_interface_1.ConflictError(`Control version mismatch. Expected '${existing.version}', got '${data.version}'`);
            }
            const updated = {
                ...existing,
                ...data,
                updated_at: new Date(),
            };
            this.controls.set(id, updated);
            return this.deepClone(updated);
        });
    }
    async findJobs(filter) {
        return this.withLock(async () => {
            let jobs = Array.from(this.jobs.values());
            // Always exclude __watch__ jobs
            jobs = jobs.filter((job) => job.name !== WATCH_JOB_NAME);
            if (filter) {
                jobs = jobs.filter((job) => {
                    if (filter.name && job.name !== filter.name)
                        return false;
                    if (filter.type && job.type !== filter.type)
                        return false;
                    if (filter.enabled !== undefined && job.enabled !== filter.enabled)
                        return false;
                    if (filter.deleted === 'not-null' && !job.deleted)
                        return false;
                    if (filter.deleted === null && job.deleted)
                        return false;
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
            const pagination = {
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
    async findJob(id) {
        return this.withLock(async () => {
            const job = this.jobs.get(id) || null;
            // Exclude deleted jobs by default
            if (job && job.deleted) {
                return null;
            }
            return job ? this.deepClone(job) : null;
        });
    }
    async findJobByName(name) {
        return this.withLock(async () => {
            const id = this.jobsByName.get(name);
            if (!id)
                return null;
            const job = this.jobs.get(id) || null;
            // Exclude deleted jobs by default
            if (job && job.deleted) {
                return null;
            }
            return job ? this.deepClone(job) : null;
        });
    }
    async createJob(data) {
        return this.withLock(async () => {
            if (this.jobsByName.has(data.name)) {
                throw new storage_interface_1.ConflictError(`Job with name '${data.name}' already exists`);
            }
            const job = {
                id: (0, crypto_1.randomUUID)(),
                created_at: new Date(),
                updated_at: new Date(),
                deleted: undefined,
                ...data,
            };
            this.jobs.set(job.id, job);
            this.jobsByName.set(job.name, job.id);
            return this.deepClone(job);
        });
    }
    async updateJob(id, data) {
        return this.withLock(async () => {
            const existing = this.jobs.get(id);
            if (!existing) {
                throw new storage_interface_1.NotFoundError('Job', id);
            }
            if (data.name && data.name !== existing.name && this.jobsByName.has(data.name)) {
                throw new storage_interface_1.ConflictError(`Job with name '${data.name}' already exists`);
            }
            const updated = {
                ...existing,
                ...data,
                updated_at: new Date(),
            };
            if (data.name && data.name !== existing.name) {
                this.jobsByName.delete(existing.name);
                this.jobsByName.set(updated.name, id);
            }
            this.jobs.set(id, updated);
            return this.deepClone(updated);
        });
    }
    async deleteJob(id) {
        return this.withLock(async () => {
            const existing = this.jobs.get(id);
            if (!existing) {
                throw new storage_interface_1.NotFoundError('Job', id);
            }
            const updated = {
                ...existing,
                deleted: new Date(),
                updated_at: new Date(),
            };
            this.jobs.set(id, updated);
        });
    }
    async createJobRun(data) {
        return this.withLock(async () => {
            if (!this.jobs.has(data.job_id)) {
                throw new storage_interface_1.StorageError(`Cannot create job run: Job '${data.job_id}' not found`, 'INVALID_REFERENCE');
            }
            const jobRun = {
                id: (0, crypto_1.randomUUID)(),
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
    async updateJobRun(id, data) {
        return this.withLock(async () => {
            const existing = this.jobRuns.get(id);
            if (!existing) {
                throw new storage_interface_1.NotFoundError('JobRun', id);
            }
            const updated = {
                ...existing,
                ...data,
                updated_at: new Date(),
            };
            this.jobRuns.set(id, updated);
            return this.deepClone(updated);
        });
    }
    async findJobRuns(filter) {
        return this.withLock(async () => {
            let runs = Array.from(this.jobRuns.values());
            if (filter) {
                runs = runs.filter((jobRun) => {
                    if (filter.job_id && jobRun.job_id !== filter.job_id)
                        return false;
                    if (filter.started_after && jobRun.started <= filter.started_after)
                        return false;
                    if (filter.started_before && jobRun.started >= filter.started_before)
                        return false;
                    if (filter.status === 'completed' && !jobRun.completed)
                        return false;
                    if (filter.status === 'failed' && !jobRun.failed)
                        return false;
                    if (filter.status === 'running' && (jobRun.completed || jobRun.failed))
                        return false;
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
            const pagination = {
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
    async executeQuery(sql) {
        throw new storage_interface_1.StorageError('executeQuery not supported by InMemoryStorage', 'NOT_SUPPORTED');
    }
    async clear() {
        return this.withLock(async () => {
            this.controls.clear();
            this.jobs.clear();
            this.jobsByName.clear();
            this.jobRuns.clear();
        });
    }
}
exports.InMemoryStorage = InMemoryStorage;
