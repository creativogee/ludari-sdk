import { Lens } from './lens';

describe('Lens', () => {
  let lens: Lens;

  beforeEach(() => {
    lens = new Lens();
  });

  describe('initialization', () => {
    it('should create an empty lens', () => {
      expect(lens.isEmpty).toBe(true);
      expect(lens.getFrames()).toBe('[]');
      expect(lens.frameCount).toBe(0);
    });
  });

  describe('frame capture', () => {
    it('should capture error frames', () => {
      lens.captureError('Test error message', 'Error Title');

      expect(lens.isEmpty).toBe(false);
      const frames = JSON.parse(lens.getFrames());
      expect(frames).toHaveLength(1);
      expect(frames[0]).toMatchObject({
        level: 'error',
        title: 'Error Title',
        message: 'Test error message',
      });
      expect(frames[0].timestamp).toBeDefined();
    });

    it('should capture error frames with Error object', () => {
      const error = new Error('Test error');
      lens.captureError(error, 'Error Title');

      const frames = JSON.parse(lens.getFrames());
      expect(frames[0]).toMatchObject({
        level: 'error',
        title: 'Error Title',
        message: 'Test error',
        errorName: 'Error',
      });
      expect(frames[0].stack).toBeDefined();
    });

    it('should capture error frames with default title', () => {
      lens.captureError('Test error message');

      const frames = JSON.parse(lens.getFrames());
      expect(frames[0]).toMatchObject({
        level: 'error',
        title: 'Error',
        message: 'Test error message',
      });
    });

    it('should capture error frames with additional data', () => {
      const additionalData = { userId: '123', action: 'login' };
      lens.captureError('Test error', 'Custom Error', additionalData);

      const frames = JSON.parse(lens.getFrames());
      expect(frames[0]).toMatchObject({
        level: 'error',
        title: 'Custom Error',
        message: 'Test error',
        userId: '123',
        action: 'login',
      });
    });

    it('should capture info frames', () => {
      lens.captureInfo('Info message', 'Info Title');

      const frames = JSON.parse(lens.getFrames());
      expect(frames[0]).toMatchObject({
        level: 'info',
        title: 'Info Title',
        message: 'Info message',
      });
    });

    it('should capture info frames with default title', () => {
      lens.captureInfo('Info message');

      const frames = JSON.parse(lens.getFrames());
      expect(frames[0]).toMatchObject({
        level: 'info',
        title: 'Info',
        message: 'Info message',
      });
    });

    it('should capture info frames with additional data', () => {
      const additionalData = { userId: '123', action: 'login' };
      lens.captureInfo('Info message', 'Custom Info', additionalData);

      const frames = JSON.parse(lens.getFrames());
      expect(frames[0]).toMatchObject({
        level: 'info',
        title: 'Custom Info',
        message: 'Info message',
        userId: '123',
        action: 'login',
      });
    });

    it('should capture warning frames', () => {
      lens.captureWarning('Warning message', 'Warning Title');

      const frames = JSON.parse(lens.getFrames());
      expect(frames[0]).toMatchObject({
        level: 'warning',
        title: 'Warning Title',
        message: 'Warning message',
      });
    });

    it('should capture warning frames with default title', () => {
      lens.captureWarning('Warning message');

      const frames = JSON.parse(lens.getFrames());
      expect(frames[0]).toMatchObject({
        level: 'warning',
        title: 'Warning',
        message: 'Warning message',
      });
    });

    it('should capture warning frames with additional data', () => {
      const additionalData = { userId: '123', action: 'login' };
      lens.captureWarning('Warning message', 'Custom Warning', additionalData);

      const frames = JSON.parse(lens.getFrames());
      expect(frames[0]).toMatchObject({
        level: 'warning',
        title: 'Custom Warning',
        message: 'Warning message',
        userId: '123',
        action: 'login',
      });
    });

    it('should capture debug frames', () => {
      lens.captureDebug('Debug message', 'Debug Title');

      const frames = JSON.parse(lens.getFrames());
      expect(frames[0]).toMatchObject({
        level: 'debug',
        title: 'Debug Title',
        message: 'Debug message',
      });
    });

    it('should capture debug frames with default title', () => {
      lens.captureDebug('Debug message');

      const frames = JSON.parse(lens.getFrames());
      expect(frames[0]).toMatchObject({
        level: 'debug',
        title: 'Debug',
        message: 'Debug message',
      });
    });

    it('should capture debug frames with additional data', () => {
      const additionalData = { userId: '123', action: 'login' };
      lens.captureDebug('Debug message', 'Custom Debug', additionalData);

      const frames = JSON.parse(lens.getFrames());
      expect(frames[0]).toMatchObject({
        level: 'debug',
        title: 'Custom Debug',
        message: 'Debug message',
        userId: '123',
        action: 'login',
      });
    });

    it('should capture metric frames', () => {
      lens.captureMetric('test-metric', 100, 'ms', { context: 'test' });

      const frames = JSON.parse(lens.getFrames());
      expect(frames[0]).toMatchObject({
        level: 'metric',
        title: 'Metric: test-metric',
        metricName: 'test-metric',
        metricValue: 100,
        metricUnit: 'ms',
        context: 'test',
      });
    });

    it('should capture metric frames without unit', () => {
      lens.captureMetric('test-metric', 100);

      const frames = JSON.parse(lens.getFrames());
      expect(frames[0]).toMatchObject({
        level: 'metric',
        title: 'Metric: test-metric',
        metricName: 'test-metric',
        metricValue: 100,
      });
      expect(frames[0].metricUnit).toBeUndefined();
    });

    it('should capture metric frames with additional data', () => {
      const additionalData = { userId: '123', action: 'login' };
      lens.captureMetric('test-metric', 100, 'ms', additionalData);

      const frames = JSON.parse(lens.getFrames());
      expect(frames[0]).toMatchObject({
        level: 'metric',
        title: 'Metric: test-metric',
        metricName: 'test-metric',
        metricValue: 100,
        metricUnit: 'ms',
        userId: '123',
        action: 'login',
      });
    });

    it('should capture custom frames', () => {
      lens.capture({
        title: 'Custom frame',
        customField: 'custom value',
      });

      const frames = JSON.parse(lens.getFrames());
      expect(frames[0]).toMatchObject({
        title: 'Custom frame',
        customField: 'custom value',
      });
    });

    it('should capture frames with existing timestamp', () => {
      const customTimestamp = '2023-01-01T00:00:00.000Z';
      lens.capture({
        title: 'Custom frame',
        timestamp: customTimestamp,
      });

      const frames = JSON.parse(lens.getFrames());
      expect(frames[0].timestamp).toBe(customTimestamp);
    });

    it('should throw error for frame without title', () => {
      expect(() => {
        lens.capture({} as any);
      }).toThrow('Frame must have a title');
    });

    it('should throw error for frame with empty title', () => {
      expect(() => {
        lens.capture({ title: '' });
      }).toThrow('Frame must have a title');
    });

    it('should throw error for frame with null title', () => {
      expect(() => {
        lens.capture({ title: null as any });
      }).toThrow('Frame must have a title');
    });
  });

  describe('multiple frames', () => {
    it('should capture multiple frames in order', () => {
      lens.captureInfo('First message', 'First');
      lens.captureError('Second message', 'Second');
      lens.captureDebug('Third message', 'Third');

      const frames = JSON.parse(lens.getFrames());
      expect(frames).toHaveLength(3);
      expect(frames[0].title).toBe('First');
      expect(frames[1].title).toBe('Second');
      expect(frames[2].title).toBe('Third');
    });

    it('should maintain chronological order of timestamps', async () => {
      lens.captureInfo('First message', 'First');
      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 1));
      lens.captureInfo('Second message', 'Second');

      const frames = JSON.parse(lens.getFrames());
      const firstTime = new Date(frames[0].timestamp).getTime();
      const secondTime = new Date(frames[1].timestamp).getTime();
      expect(secondTime).toBeGreaterThanOrEqual(firstTime);
    });
  });

  describe('frame serialization', () => {
    it('should serialize frames as valid JSON', () => {
      lens.captureInfo('Test message', 'Test');
      lens.captureError('Error message', 'Error');

      const framesString = lens.getFrames();
      expect(() => JSON.parse(framesString)).not.toThrow();

      const frames = JSON.parse(framesString);
      expect(Array.isArray(frames)).toBe(true);
      expect(frames).toHaveLength(2);
    });

    it('should handle complex objects in frames', () => {
      const complexObject = {
        nested: { value: 'test' },
        array: [1, 2, 3],
        boolean: true,
        null: null,
      };

      lens.capture({
        title: 'Complex',
        data: complexObject,
      });

      const frames = JSON.parse(lens.getFrames());
      expect(frames[0].data).toEqual(complexObject);
    });
  });

  describe('isEmpty property', () => {
    it('should be true for new lens', () => {
      expect(lens.isEmpty).toBe(true);
    });

    it('should be false after capturing frames', () => {
      lens.captureInfo('Test message', 'Test');
      expect(lens.isEmpty).toBe(false);
    });
  });

  describe('frameCount property', () => {
    it('should return 0 for new lens', () => {
      expect(lens.frameCount).toBe(0);
    });

    it('should return correct count after capturing frames', () => {
      expect(lens.frameCount).toBe(0);
      lens.captureInfo('First message');
      expect(lens.frameCount).toBe(1);
      lens.captureInfo('Second message');
      expect(lens.frameCount).toBe(2);
    });
  });

  describe('getFrameArray method', () => {
    it('should return empty array for new lens', () => {
      const frames = lens.getFrameArray();
      expect(frames).toEqual([]);
    });

    it('should return array of captured frames', () => {
      lens.captureInfo('First message', 'First');
      lens.captureInfo('Second message', 'Second');

      const frames = lens.getFrameArray();
      expect(frames).toHaveLength(2);
      expect(frames[0].title).toBe('First');
      expect(frames[1].title).toBe('Second');
    });

    it('should return copy of frames array', () => {
      lens.captureInfo('Test message');
      const frames = lens.getFrameArray();

      // Modify the returned array
      frames.push({ title: 'Modified' } as any);

      // Original lens should not be affected
      expect(lens.frameCount).toBe(1);
      expect(lens.getFrameArray()).toHaveLength(1);
    });
  });

  describe('clear method', () => {
    it('should clear all frames', () => {
      lens.captureInfo('First message');
      lens.captureInfo('Second message');
      expect(lens.frameCount).toBe(2);

      lens.clear();
      expect(lens.frameCount).toBe(0);
      expect(lens.isEmpty).toBe(true);
      expect(lens.getFrames()).toBe('[]');
    });

    it('should work on empty lens', () => {
      expect(() => lens.clear()).not.toThrow();
      expect(lens.isEmpty).toBe(true);
      expect(lens.frameCount).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle frames with all data types', () => {
      const frame = {
        title: 'All Types',
        string: 'test',
        number: 42,
        boolean: true,
        null: null,
        undefined: undefined,
        array: [1, 2, 3],
        object: { key: 'value' },
      };

      lens.capture(frame);
      const frames = JSON.parse(lens.getFrames());
      expect(frames[0]).toMatchObject({
        title: 'All Types',
        string: 'test',
        number: 42,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        object: { key: 'value' },
      });
      // undefined values should not be serialized
      expect(frames[0].undefined).toBeUndefined();
    });

    it('should handle very long messages', () => {
      const longMessage = 'a'.repeat(10000);
      lens.captureInfo(longMessage, 'Long Message');

      const frames = JSON.parse(lens.getFrames());
      expect(frames[0].message).toBe(longMessage);
    });

    it('should handle special characters in messages', () => {
      const specialMessage = 'Special chars: !@#$%^&*()_+-=[]{}|;:,.<>?';
      lens.captureInfo(specialMessage, 'Special');

      const frames = JSON.parse(lens.getFrames());
      expect(frames[0].message).toBe(specialMessage);
    });
  });
});
