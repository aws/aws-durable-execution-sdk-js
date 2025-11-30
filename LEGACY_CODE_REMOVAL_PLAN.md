# Legacy Code Removal Plan

## Overview

Remove legacy termination patterns and replace with centralized approach across the codebase.

## Files with Legacy Patterns

### 1. Core Legacy Files to Remove/Replace

- `src/utils/wait-before-continue/wait-before-continue.ts` - **REMOVE ENTIRELY**
- `src/utils/termination-helper/termination-helper.ts` - **REMOVE terminate() function**

### 2. Handler Files with Legacy Patterns

- `src/handlers/step-handler/step-handler.ts` - Replace with centralized version
- `src/handlers/wait-handler/wait-handler.ts` - Replace with centralized version
- `src/handlers/callback-handler/callback-promise.ts` - Replace with centralized version
- `src/handlers/wait-for-condition-handler/wait-for-condition-handler.ts` - Needs migration
- `src/handlers/invoke-handler/invoke-handler.ts` - Needs migration

## Legacy Patterns to Remove

### Pattern 1: waitBeforeContinue calls

```typescript
await waitBeforeContinue({
  checkHasRunningOperations: true,
  checkStepStatus: true,
  checkTimer: true,
  scheduledEndTimestamp: stepData?.WaitDetails?.ScheduledEndTimestamp,
  stepId,
  context,
  hasRunningOperations,
  operationsEmitter: getOperationsEmitter(),
  checkpoint,
});
```

### Pattern 2: Direct terminate() calls

```typescript
return terminate(
  context,
  TerminationReason.RETRY_SCHEDULED,
  `Retry scheduled for ${name || stepId}`,
);
```

### Pattern 3: waitForContinuation helper

```typescript
const waitForContinuation = async (
  context: ExecutionContext,
  stepId: string,
  name: string | undefined,
  hasRunningOperations: () => boolean,
  getOperationsEmitter: () => EventEmitter,
  checkpoint: Checkpoint,
  onAwaitedChange?: (callback: () => void) => void,
): Promise<void> => {
  // 80+ lines of complex logic
};
```

## Replacement Pattern

All legacy patterns should be replaced with:

```typescript
// Give control to checkpoint manager
return new Promise<T>((resolve, reject) => {
  const resolver: PromiseResolver<T> = {
    handlerId: `${stepId}-${operation}`,
    resolve: () => { /* resume logic */ },
    reject,
    scheduledTime: scheduledTime, // or undefined for indefinite wait
    metadata: { stepId, reason, ... }
  };

  checkpointManager.scheduleResume(resolver);
});
```

## Implementation Steps

### Phase 1: Remove Core Legacy Files

1. Delete `wait-before-continue.ts`
2. Remove `terminate()` function from `termination-helper.ts`
3. Update imports across codebase

### Phase 2: Replace Handler Implementations

1. Replace step-handler.ts with centralized version
2. Replace wait-handler.ts with centralized version
3. Replace callback-promise.ts with centralized version
4. Migrate wait-for-condition-handler.ts
5. Migrate invoke-handler.ts

### Phase 3: Update Integration Points

1. Update durable-context.ts to use centralized handlers
2. Update any remaining imports
3. Remove unused termination helper functions

### Phase 4: Testing and Validation

1. Run existing tests to ensure compatibility
2. Add integration tests for centralized approach
3. Performance validation

## Expected Benefits

- **Code Reduction**: Remove ~500+ lines of complex termination logic
- **Simplified Architecture**: Single pattern across all handlers
- **Centralized Control**: Global view of system state
- **Improved Maintainability**: Less complex code to maintain
- **Better Performance**: Reduced Lambda invocations through centralized termination

## Risk Mitigation

- Keep legacy files temporarily during migration
- Gradual rollout with feature flags if needed
- Comprehensive testing before removal
- Rollback plan if issues arise
