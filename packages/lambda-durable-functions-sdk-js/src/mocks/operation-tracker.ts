/**
 * Tracks operation indices for mock resolution
 */
export class OperationTracker {
  private globalIndex = 0;
  private readonly namedIndices = new Map<string, number>();

  incrementGlobal(): number {
    return this.globalIndex++;
  }

  incrementNamed(name: string): number {
    const current = this.namedIndices.get(name) ?? -1;
    const next = current + 1;
    this.namedIndices.set(name, next);
    return next;
  }

  getCurrentGlobal(): number {
    return this.globalIndex;
  }

  getCurrentNamed(name: string): number {
    return this.namedIndices.get(name) ?? -1;
  }
}
