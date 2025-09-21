import { noNestedDurableOperations } from '../no-nested-durable-operations';

describe('no-nested-durable-operations', () => {
  it('should be defined', () => {
    expect(noNestedDurableOperations).toBeDefined();
    expect(noNestedDurableOperations.meta).toBeDefined();
    expect(noNestedDurableOperations.create).toBeDefined();
  });

  it('should have correct meta information', () => {
    const meta = noNestedDurableOperations.meta!;
    expect(meta.type).toBe('problem');
    expect(meta.docs?.description).toContain('same context object');
    expect(meta.messages?.sameContextUsage).toBeDefined();
  });
});
