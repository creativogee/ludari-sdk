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
export function bindMethods(instance: any): void {
  const propertyNames = Object.getOwnPropertyNames(Object.getPrototypeOf(instance));

  for (const propertyName of propertyNames) {
    const propertyValue = instance[propertyName];

    if (typeof propertyValue === 'function' && propertyName !== 'constructor') {
      instance[propertyName] = propertyValue.bind(instance);
    }
  }
}

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
export function Bind(): any {
  return function (target: any, propertyKey?: string, descriptor?: PropertyDescriptor): any {
    // Called as class decorator: @Bind() on class
    if (arguments.length === 1 && typeof target === 'function') {
      return class extends target {
        constructor(...args: any[]) {
          super(...args);

          // Auto-bind all methods after construction
          const propertyNames = Object.getOwnPropertyNames(Object.getPrototypeOf(this));

          for (const propertyName of propertyNames) {
            const propertyValue = this[propertyName];

            if (typeof propertyValue === 'function' && propertyName !== 'constructor') {
              this[propertyName] = propertyValue.bind(this);
            }
          }
        }
      };
    }

    // Called as method decorator: @Bind() on method
    if (arguments.length === 3 && descriptor) {
      const originalMethod = descriptor.value;

      descriptor.get = function (this: any) {
        if (!this._boundMethods) {
          this._boundMethods = new Map();
        }

        if (!this._boundMethods.has(propertyKey!)) {
          this._boundMethods.set(propertyKey!, originalMethod.bind(this));
        }

        return this._boundMethods.get(propertyKey!);
      };

      descriptor.set = function () {
        throw new Error(`Cannot reassign bound method ${propertyKey}`);
      };

      return descriptor;
    }
  };
}

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
export abstract class BaseJobHandler implements Handler {
  // No constructor needed - use @Bind() decorator for method binding

  async executeMethod(methodName: string, context: JobContext, lens: Lens): Promise<any> {
    const method = (this as any)[methodName];

    if (typeof method !== 'function') {
      throw new Error(`Job method '${methodName}' not found on ${this.constructor.name}`);
    }

    return method.call(this, context, lens);
  }

  hasMethod(methodName: string): boolean {
    const method = (this as any)[methodName];
    return typeof method === 'function' && methodName !== 'constructor';
  }

  getAvailableMethods(): string[] {
    const propertyNames = Object.getOwnPropertyNames(Object.getPrototypeOf(this));

    return propertyNames.filter((name) => {
      const property = (this as any)[name];
      return (
        typeof property === 'function' &&
        name !== 'constructor' &&
        name !== 'executeMethod' &&
        name !== 'hasMethod' &&
        name !== 'getAvailableMethods'
      );
    });
  }
}
