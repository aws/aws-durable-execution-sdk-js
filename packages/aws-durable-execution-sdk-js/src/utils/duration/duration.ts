import { Duration } from "../../types";

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
