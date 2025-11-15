import { Duration, WaitOptions } from "../../types";

/**
 * Converts a Duration object to total seconds
 * @param duration - Duration object with at least one time unit specified
 * @returns Total duration in seconds
 */
export function durationToSeconds(duration: Duration): number {
  const days = "days" in duration ? (duration.days ?? 0) : 0;
  const hours = "hours" in duration ? (duration.hours ?? 0) : 0;
  const minutes = "minutes" in duration ? (duration.minutes ?? 0) : 0;
  const seconds = "seconds" in duration ? (duration.seconds ?? 0) : 0;

  return days * 24 * 60 * 60 + hours * 60 * 60 + minutes * 60 + seconds;
}

/**
 * Converts WaitOptions to total seconds
 * @param waitOptions - WaitOptions object with duration or endTimestamp
 * @returns Total duration in seconds
 */
export function waitOptionsToSeconds(waitOptions: WaitOptions): number {
  // Handle endTimestamp case
  if ("endTimestamp" in waitOptions) {
    const endTime = new Date(waitOptions.endTimestamp).getTime();
    const currentTime = Date.now();
    const diffMs = endTime - currentTime;

    // If the timestamp is in the past, return 0
    if (diffMs <= 0) {
      return 0;
    }

    // Convert milliseconds to seconds
    return Math.ceil(diffMs / 1000);
  }

  // Handle traditional duration format
  return durationToSeconds(waitOptions);
}
