/**
 * Lens class for capturing logs and metrics during job execution
 * Same as v2 but moved to v3 architecture
 */
import { Frame, Lens as LensInterface } from '../types/core';
/**
 * Lens implementation for structured logging and metrics collection
 * Used within job execution to capture events, errors, and custom data
 */
export declare class Lens implements LensInterface {
    private readonly frames;
    /**
     * Check if any frames have been captured
     */
    get isEmpty(): boolean;
    /**
     * Capture a log frame with title, message, and custom data
     * @param action Frame data to capture
     */
    capture(action: Frame): void;
    /**
     * Get all captured frames as JSON string
     * @returns JSON string of all frames
     */
    getFrames(): string;
    /**
     * Get captured frames as array (for programmatic access)
     * @returns Array of frame objects
     */
    getFrameArray(): Frame[];
    /**
     * Clear all captured frames
     */
    clear(): void;
    /**
     * Get count of captured frames
     */
    get frameCount(): number;
    /**
     * Capture an error frame with standardized format
     * @param error Error object or message
     * @param title Optional title (defaults to 'Error')
     * @param additionalData Additional context data
     */
    captureError(error: Error | string, title?: string, additionalData?: Record<string, any>): void;
    /**
     * Capture an info frame with standardized format
     * @param message Info message
     * @param title Optional title (defaults to 'Info')
     * @param additionalData Additional context data
     */
    captureInfo(message: string, title?: string, additionalData?: Record<string, any>): void;
    /**
     * Capture a warning frame with standardized format
     * @param message Warning message
     * @param title Optional title (defaults to 'Warning')
     * @param additionalData Additional context data
     */
    captureWarning(message: string, title?: string, additionalData?: Record<string, any>): void;
    /**
     * Capture a debug frame with standardized format
     * @param message Debug message
     * @param title Optional title (defaults to 'Debug')
     * @param additionalData Additional context data
     */
    captureDebug(message: string, title?: string, additionalData?: Record<string, any>): void;
    /**
     * Capture a metric frame with standardized format
     * @param name Metric name
     * @param value Metric value
     * @param unit Optional unit (e.g., 'ms', 'bytes', 'count')
     * @param additionalData Additional context data
     */
    captureMetric(name: string, value: number, unit?: string, additionalData?: Record<string, any>): void;
}
