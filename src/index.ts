/**
 * Ludari - Modern, flexible cron job manager
 * Main package exports
 */

// Core exports (explicit to avoid conflicts)
export { Lens } from './core/lens';
export { Manager } from './core/manager';
export type { ManagerOptions } from './core/manager';
export * from './interfaces';
export * from './types';

// Dependency injection tokens
export const OLUDARI = Symbol('OLUDARI');

// Built-in implementations
export * from './implementations';
