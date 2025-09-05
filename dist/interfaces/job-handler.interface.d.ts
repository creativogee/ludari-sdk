/**
 * Job handler interface for Nest Cron Manager v3
 * Used for 'method' type jobs that execute methods on a service class
 */
import { JobContext, Lens } from '../types/core';
/**
 * Job handler interface for executing 'method' type jobs
 * Implementations should provide methods that can be called by name
 */
export interface Handler {
    /**
     * Execute a job method by name
     * @param methodName Name of the method to execute (should match Config.name)
     * @param context Job execution context with runtime parameters
     * @param lens Logging and metrics collection interface
     * @returns Job execution result (can be any serializable value)
     * @throws Error if method doesn't exist or execution fails
     */
    executeMethod(methodName: string, context: JobContext, lens: Lens): Promise<any>;
    /**
     * Check if a job method exists
     * @param methodName Name of the method to check
     * @returns true if method exists and can be executed
     */
    hasMethod?(methodName: string): boolean;
    /**
     * Get list of available job methods
     * @returns Array of method names that can be executed
     * @note Optional - used for validation and debugging
     */
    getAvailableMethods?(): string[];
}
/**
 * Utility function to bind all methods of a class instance to preserve 'this' context
 * This should be called in the constructor or onModuleInit of job handler implementations
 * @param instance The class instance to bind methods for
 */
export declare function bindMethods(instance: any): void;
/**
 * Unified decorator for method binding that works as both class and method decorator
 *
 * Class usage: @Bind() - binds ALL methods
 * Method usage: @Bind() - binds individual method
 *
 * @example
 * ```typescript
 * @Injectable()
 * @Bind() // Binds all methods
 * export class JobHandlerService extends BaseJobHandler {
 *   async job1(context, lens) { ... }
 *   async job2(context, lens) { ... }
 * }
 *
 * // OR bind individual methods:
 * @Injectable()
 * export class JobHandlerService extends BaseJobHandler {
 *   @Bind() // Same syntax - binds this method only
 *   async job1(context, lens) { ... }
 *
 *   async job2(context, lens) { ... } // not bound
 * }
 * ```
 */
export declare function Bind(): any;
/**
 * Base implementation of Handler that uses reflection to call methods
 * Users can extend this class and add job methods, or implement Handler directly
 *
 * For automatic method binding, use the @Bind() decorator:
 * @Bind() // Class decorator - binds all methods
 * class MyJobHandler extends BaseJobHandler { ... }
 *
 * Or bind individual methods:
 * class MyJobHandler extends BaseJobHandler {
 *   @Bind() // Method decorator - binds this method only
 *   async myJob(context, lens) { ... }
 * }
 */
export declare abstract class BaseJobHandler implements Handler {
    private static readonly FORBIDDEN_METHODS;
    executeMethod(methodName: string, context: JobContext, lens: Lens): Promise<any>;
    hasMethod(methodName: string): boolean;
    getAvailableMethods(): string[];
}
