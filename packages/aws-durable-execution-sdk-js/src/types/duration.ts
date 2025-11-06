/**
 * Represents a duration of time with factory methods for common units
 */
export class Duration {
  private constructor(private readonly seconds: number) {}

  /**
   * Creates a Duration from seconds
   * @param seconds - Number of seconds
   * @returns Duration instance
   */
  static ofSeconds(seconds: number): Duration {
    return new Duration(seconds);
  }

  /**
   * Creates a Duration from minutes
   * @param minutes - Number of minutes
   * @returns Duration instance
   */
  static ofMinutes(minutes: number): Duration {
    return new Duration(minutes * 60);
  }

  /**
   * Gets the duration in seconds
   * @returns Duration in seconds
   */
  toSeconds(): number {
    return this.seconds;
  }
}
