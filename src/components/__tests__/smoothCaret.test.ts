import { describe, it, expect, vi } from 'vitest';
import {
  SmoothCaretRetryController,
  isInvalidCoords,
  type CaretCoords,
} from '../SmoothCaret';

describe('SmoothCaret Retry Limit & Infinite RAF Loop Regression Tests', () => {
  it('1. Caret coordinates are valid immediately -> processed without scheduling retries', () => {
    const controller = new SmoothCaretRetryController();
    const scheduleRetry = vi.fn();
    const validCoords: CaretCoords = { left: 120, top: 45, bottom: 65, right: 121 };

    expect(isInvalidCoords(validCoords)).toBe(false);
    const result = controller.handleCoords(validCoords, scheduleRetry);

    expect(result).toBe(true);
    expect(controller.retryCount).toBe(0);
    expect(scheduleRetry).not.toHaveBeenCalled();
  });

  it('2. Coordinates initially invalid (0,0,0) but become valid within 3 retries', () => {
    const controller = new SmoothCaretRetryController();
    const scheduleRetry = vi.fn();
    const invalidCoords: CaretCoords = { left: 0, top: 0, bottom: 0 };
    const validCoords: CaretCoords = { left: 50, top: 100, bottom: 120 };

    expect(isInvalidCoords(invalidCoords)).toBe(true);

    // Frame 1: invalid -> retry scheduled
    expect(controller.handleCoords(invalidCoords, scheduleRetry)).toBe(true);
    expect(controller.retryCount).toBe(1);
    expect(scheduleRetry).toHaveBeenCalledTimes(1);

    // Frame 2: invalid -> retry scheduled
    expect(controller.handleCoords(invalidCoords, scheduleRetry)).toBe(true);
    expect(controller.retryCount).toBe(2);
    expect(scheduleRetry).toHaveBeenCalledTimes(2);

    // Frame 3: valid -> resolved, retryCount reset to 0
    expect(controller.handleCoords(validCoords, scheduleRetry)).toBe(true);
    expect(controller.retryCount).toBe(0);
    expect(scheduleRetry).toHaveBeenCalledTimes(2); // no 3rd retry scheduled
  });

  it('3. Coordinates remain invalid beyond retry limit -> strictly capped at 3, stops scheduling', () => {
    const controller = new SmoothCaretRetryController();
    const scheduleRetry = vi.fn();
    const invalidCoords: CaretCoords = { left: 0, top: 0, bottom: 0 };

    // Retries 1, 2, 3 succeed in scheduling
    expect(controller.handleCoords(invalidCoords, scheduleRetry)).toBe(true);
    expect(controller.handleCoords(invalidCoords, scheduleRetry)).toBe(true);
    expect(controller.handleCoords(invalidCoords, scheduleRetry)).toBe(true);
    expect(controller.retryCount).toBe(3);
    expect(scheduleRetry).toHaveBeenCalledTimes(3);

    // 4th attempt: must reject and NOT schedule (stops infinite RAF loop!)
    const frame4Result = controller.handleCoords(invalidCoords, scheduleRetry);
    expect(frame4Result).toBe(false);
    expect(scheduleRetry).toHaveBeenCalledTimes(3); // strictly capped

    // 5th attempt: continues to remain blocked
    const frame5Result = controller.handleCoords(invalidCoords, scheduleRetry);
    expect(frame5Result).toBe(false);
    expect(scheduleRetry).toHaveBeenCalledTimes(3);
  });

  it('4. Subsequent focus or note selection update recovers the caret after being capped', () => {
    const controller = new SmoothCaretRetryController();
    const scheduleRetry = vi.fn();
    const invalidCoords: CaretCoords = { left: 0, top: 0, bottom: 0 };
    const validCoords: CaretCoords = { left: 100, top: 200, bottom: 220 };

    // Max out retries
    for (let i = 0; i < 5; i++) {
      controller.handleCoords(invalidCoords, scheduleRetry);
    }
    expect(scheduleRetry).toHaveBeenCalledTimes(3);

    // User switches note or clicks/focuses editor -> calls reset()
    controller.reset();
    expect(controller.retryCount).toBe(0);

    // Now valid coordinates immediately recover
    const recovered = controller.handleCoords(validCoords, scheduleRetry);
    expect(recovered).toBe(true);
    expect(controller.retryCount).toBe(0);
  });

  it('5. Repeated rapid note switching (100 switches) does not accumulate or create endless loop', () => {
    const controller = new SmoothCaretRetryController();
    let totalScheduledFrames = 0;

    // Simulate 100 note switches where each switch temporarily mounts with unmeasured (0,0,0) DOM
    for (let noteSwitch = 0; noteSwitch < 100; noteSwitch++) {
      controller.reset(); // trigger on note switch
      const scheduleFn = () => {
        totalScheduledFrames++;
      };

      // Each unmeasured note switch schedules at most 3 frames before capping
      for (let attempt = 0; attempt < 10; attempt++) {
        controller.handleCoords({ left: 0, top: 0, bottom: 0 }, scheduleFn);
      }
    }

    // In an infinite loop, this would have scheduled 1000+ frames and spun 100% CPU.
    // With the cap, exactly 300 frames (3 per switch) are ever scheduled.
    expect(totalScheduledFrames).toBe(300);
  });
});
