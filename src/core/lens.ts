/**
 * Lens class for capturing logs and metrics during job execution
 * Same as v2 but moved to v3 architecture
 */

import { Frame, Lens as LensInterface } from '../types/core'

/**
 * Lens implementation for structured logging and metrics collection
 * Used within job execution to capture events, errors, and custom data
 */
export class Lens implements LensInterface {
  private readonly frames: Frame[] = []

  /**
   * Check if any frames have been captured
   */
  get isEmpty(): boolean {
    return this.frames.length === 0
  }

  /**
   * Capture a log frame with title, message, and custom data
   * @param action Frame data to capture
   */
  capture(action: Frame): void {
    // Validate required fields
    if (!action.title) {
      throw new Error('Frame must have a title')
    }

    // Add timestamp if not provided
    const frameWithTimestamp: Frame = {
      timestamp: new Date().toISOString(),
      ...action,
    }

    this.frames.push(frameWithTimestamp)
  }

  /**
   * Get all captured frames as JSON string
   * @returns JSON string of all frames
   */
  getFrames(): string {
    return JSON.stringify(this.frames)
  }

  /**
   * Get captured frames as array (for programmatic access)
   * @returns Array of frame objects
   */
  getFrameArray(): Frame[] {
    return [...this.frames]
  }

  /**
   * Clear all captured frames
   */
  clear(): void {
    this.frames.length = 0
  }

  /**
   * Get count of captured frames
   */
  get frameCount(): number {
    return this.frames.length
  }

  /**
   * Capture an error frame with standardized format
   * @param error Error object or message
   * @param title Optional title (defaults to 'Error')
   * @param additionalData Additional context data
   */
  captureError(error: Error | string, title = 'Error', additionalData?: Record<string, any>): void {
    const errorData: Frame = {
      title,
      level: 'error',
      ...additionalData,
    }

    if (error instanceof Error) {
      errorData.message = error.message
      errorData.stack = error.stack
      errorData.errorName = error.name
    } else {
      errorData.message = error
    }

    this.capture(errorData)
  }

  /**
   * Capture an info frame with standardized format
   * @param message Info message
   * @param title Optional title (defaults to 'Info')
   * @param additionalData Additional context data
   */
  captureInfo(message: string, title = 'Info', additionalData?: Record<string, any>): void {
    this.capture({
      title,
      message,
      level: 'info',
      ...additionalData,
    })
  }

  /**
   * Capture a warning frame with standardized format
   * @param message Warning message
   * @param title Optional title (defaults to 'Warning')
   * @param additionalData Additional context data
   */
  captureWarning(message: string, title = 'Warning', additionalData?: Record<string, any>): void {
    this.capture({
      title,
      message,
      level: 'warning',
      ...additionalData,
    })
  }

  /**
   * Capture a debug frame with standardized format
   * @param message Debug message
   * @param title Optional title (defaults to 'Debug')
   * @param additionalData Additional context data
   */
  captureDebug(message: string, title = 'Debug', additionalData?: Record<string, any>): void {
    this.capture({
      title,
      message,
      level: 'debug',
      ...additionalData,
    })
  }

  /**
   * Capture a metric frame with standardized format
   * @param name Metric name
   * @param value Metric value
   * @param unit Optional unit (e.g., 'ms', 'bytes', 'count')
   * @param additionalData Additional context data
   */
  captureMetric(name: string, value: number, unit?: string, additionalData?: Record<string, any>): void {
    this.capture({
      title: `Metric: ${name}`,
      metricName: name,
      metricValue: value,
      metricUnit: unit,
      level: 'metric',
      ...additionalData,
    })
  }
}