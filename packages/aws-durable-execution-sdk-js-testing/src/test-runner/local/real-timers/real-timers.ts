/**
 * @fileoverview
 * Keep track of original timers so that fake timers don't override them
 */

export const realSetTimeout = setTimeout;
export const RealDate = Date;
