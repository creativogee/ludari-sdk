"use strict";
/**
 * Job handler interface for Nest Cron Manager v3
 * Used for 'method' type jobs that execute methods on a service class
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseJobHandler = void 0;
exports.bindMethods = bindMethods;
exports.Bind = Bind;
/**
 * Utility function to bind all methods of a class instance to preserve 'this' context
 * This should be called in the constructor or onModuleInit of job handler implementations
 * @param instance The class instance to bind methods for
 */
function bindMethods(instance) {
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
function Bind() {
    return function (target, propertyKey, descriptor) {
        // Called as class decorator: @Bind() on class
        if (arguments.length === 1 && typeof target === 'function') {
            return class extends target {
                constructor(...args) {
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
            descriptor.get = function () {
                if (!this._boundMethods) {
                    this._boundMethods = new Map();
                }
                if (!this._boundMethods.has(propertyKey)) {
                    this._boundMethods.set(propertyKey, originalMethod.bind(this));
                }
                return this._boundMethods.get(propertyKey);
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
class BaseJobHandler {
    async executeMethod(methodName, context, lens) {
        // Validate method name to prevent code injection
        if (!methodName || typeof methodName !== 'string') {
            throw new Error('Method name must be a non-empty string');
        }
        // Sanitize method name - only allow alphanumeric characters and underscores
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(methodName)) {
            throw new Error(`Invalid method name: '${methodName}'. Only alphanumeric characters and underscores are allowed.`);
        }
        // Check if method exists in allowed methods whitelist
        const availableMethods = this.getAvailableMethods();
        if (!availableMethods.includes(methodName)) {
            throw new Error(`Job method '${methodName}' is not in the whitelist of available methods: ${availableMethods.join(', ')}`);
        }
        // Additional safety check - ensure method exists and is callable
        if (!this.hasMethod(methodName)) {
            throw new Error(`Job method '${methodName}' not found on ${this.constructor.name}`);
        }
        const method = this[methodName];
        if (typeof method !== 'function') {
            throw new Error(`'${methodName}' is not a function on ${this.constructor.name}`);
        }
        // Prevent calling internal/dangerous methods
        const forbiddenMethods = [
            'constructor', 'executeMethod', 'hasMethod', 'getAvailableMethods',
            '__proto__', 'prototype', 'apply', 'call', 'bind'
        ];
        if (forbiddenMethods.includes(methodName)) {
            throw new Error(`Cannot execute forbidden method: '${methodName}'`);
        }
        return method.call(this, context, lens);
    }
    hasMethod(methodName) {
        const method = this[methodName];
        return typeof method === 'function' && methodName !== 'constructor';
    }
    getAvailableMethods() {
        // Get methods from both prototype and instance, walking up the prototype chain
        // This handles cases where @Bind() decorator creates wrapper classes
        const allPropertyNames = new Set();
        // Walk up the prototype chain to find all methods
        let current = this;
        while (current && current !== Object.prototype && current.constructor !== Object) {
            // Add instance properties
            Object.getOwnPropertyNames(current).forEach(name => allPropertyNames.add(name));
            // Add prototype properties
            const proto = Object.getPrototypeOf(current);
            if (proto && proto !== Object.prototype) {
                Object.getOwnPropertyNames(proto).forEach(name => allPropertyNames.add(name));
            }
            current = proto;
        }
        return Array.from(allPropertyNames).filter((name) => {
            const property = this[name];
            // Must be a function
            if (typeof property !== 'function') {
                return false;
            }
            // Exclude internal/forbidden methods
            if (BaseJobHandler.FORBIDDEN_METHODS.includes(name)) {
                return false;
            }
            // Exclude private methods (starting with underscore)
            if (name.startsWith('_')) {
                return false;
            }
            // Exclude methods that are likely private based on naming conventions
            const privatePatterns = [
                /^(internal|private|hidden)/i,
                /Private$/i,
                /Internal$/i,
            ];
            if (privatePatterns.some(pattern => pattern.test(name))) {
                return false;
            }
            // Exclude getters/setters
            if (name.startsWith('get ') || name.startsWith('set ')) {
                return false;
            }
            return true;
        });
    }
}
exports.BaseJobHandler = BaseJobHandler;
// No constructor needed - use @Bind() decorator for method binding
// Internal/forbidden methods that cannot be executed as job methods
BaseJobHandler.FORBIDDEN_METHODS = [
    'constructor',
    'executeMethod',
    'hasMethod',
    'getAvailableMethods',
    '__proto__',
    'prototype',
    'apply',
    'call',
    'bind',
];
