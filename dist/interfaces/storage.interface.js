"use strict";
/**
 * Storage interface for Nest Cron Manager v3
 * Provides database-agnostic persistence operations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConflictError = exports.NotFoundError = exports.StorageError = void 0;
class StorageError extends Error {
    constructor(message, code, cause) {
        super(message);
        this.code = code;
        this.cause = cause;
        this.name = 'StorageError';
    }
}
exports.StorageError = StorageError;
class NotFoundError extends StorageError {
    constructor(entity, id, cause) {
        super(`${entity} with id '${id}' not found`, 'NOT_FOUND', cause);
        this.name = 'NotFoundError';
    }
}
exports.NotFoundError = NotFoundError;
class ConflictError extends StorageError {
    constructor(message, cause) {
        super(message, 'CONFLICT', cause);
        this.name = 'ConflictError';
    }
}
exports.ConflictError = ConflictError;
