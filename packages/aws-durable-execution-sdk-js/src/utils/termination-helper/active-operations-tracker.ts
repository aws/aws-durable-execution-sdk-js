/**
 * Tracks active async operations to prevent premature termination
 */
export class ActiveOperationsTracker {
  private activeCount = 0;

  /**
   * Increment the counter when starting an async operation
   */
  increment(): void {
    this.activeCount++;
  }

  /**
   * Decrement the counter when an async operation completes
   */
  decrement(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
  }

  /**
   * Check if there are any active operations
   */
  hasActive(): boolean {
    return this.activeCount > 0;
  }

  /**
   * Get the current count of active operations
   */
  getCount(): number {
    return this.activeCount;
  }

  /**
   * Reset the counter (useful for testing)
   */
  reset(): void {
    this.activeCount = 0;
  }
}

/**
 * Wraps an async function to track its execution
 */
export async function trackOperation<T>(
  tracker: ActiveOperationsTracker,
  operation: () => Promise<T>,
): Promise<T> {
  tracker.increment();
  try {
    return await operation();
  } finally {
    tracker.decrement();
  }
}
