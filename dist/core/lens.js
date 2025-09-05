"use strict";
/**
 * Lens class for capturing logs and metrics during job execution
 * Same as v2 but moved to v3 architecture
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Lens = void 0;
/**
 * Lens implementation for structured logging and metrics collection
 * Used within job execution to capture events, errors, and custom data
 */
class Lens {
    constructor() {
        this.frames = [];
    }
    /**
     * Check if any frames have been captured
     */
    get isEmpty() {
        return this.frames.length === 0;
    }
    /**
     * Capture a log frame with title, message, and custom data
     * @param action Frame data to capture
     */
    capture(action) {
        // Validate required fields
        if (!action.title) {
            throw new Error('Frame must have a title');
        }
        // Add timestamp if not provided
        const frameWithTimestamp = {
            timestamp: new Date().toISOString(),
            ...action,
        };
        this.frames.push(frameWithTimestamp);
    }
    /**
     * Get all captured frames as JSON string
     * @returns JSON string of all frames
     */
    getFrames() {
        return JSON.stringify(this.frames);
    }
    /**
     * Get captured frames as array (for programmatic access)
     * @returns Array of frame objects
     */
    getFrameArray() {
        return [...this.frames];
    }
    /**
     * Clear all captured frames
     */
    clear() {
        this.frames.length = 0;
    }
    /**
     * Get count of captured frames
     */
    get frameCount() {
        return this.frames.length;
    }
    /**
     * Capture an error frame with standardized format
     * @param error Error object or message
     * @param title Optional title (defaults to 'Error')
     * @param additionalData Additional context data
     */
    captureError(error, title = 'Error', additionalData) {
        const errorData = {
            title,
            level: 'error',
            ...additionalData,
        };
        if (error instanceof Error) {
            errorData.message = error.message;
            errorData.stack = error.stack;
            errorData.errorName = error.name;
        }
        else {
            errorData.message = error;
        }
        this.capture(errorData);
    }
    /**
     * Capture an info frame with standardized format
     * @param message Info message
     * @param title Optional title (defaults to 'Info')
     * @param additionalData Additional context data
     */
    captureInfo(message, title = 'Info', additionalData) {
        this.capture({
            title,
            message,
            level: 'info',
            ...additionalData,
        });
    }
    /**
     * Capture a warning frame with standardized format
     * @param message Warning message
     * @param title Optional title (defaults to 'Warning')
     * @param additionalData Additional context data
     */
    captureWarning(message, title = 'Warning', additionalData) {
        this.capture({
            title,
            message,
            level: 'warning',
            ...additionalData,
        });
    }
    /**
     * Capture a debug frame with standardized format
     * @param message Debug message
     * @param title Optional title (defaults to 'Debug')
     * @param additionalData Additional context data
     */
    captureDebug(message, title = 'Debug', additionalData) {
        this.capture({
            title,
            message,
            level: 'debug',
            ...additionalData,
        });
    }
    /**
     * Capture a metric frame with standardized format
     * @param name Metric name
     * @param value Metric value
     * @param unit Optional unit (e.g., 'ms', 'bytes', 'count')
     * @param additionalData Additional context data
     */
    captureMetric(name, value, unit, additionalData) {
        this.capture({
            title: `Metric: ${name}`,
            metricName: name,
            metricValue: value,
            metricUnit: unit,
            level: 'metric',
            ...additionalData,
        });
    }
}
exports.Lens = Lens;
