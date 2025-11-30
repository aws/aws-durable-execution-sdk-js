# Centralized Termination Design

## Overview

Refactor the durable execution SDK to use a centralized `OperationCoordinator` that manages operation lifecycle and termination decisions, replacing the distributed termination logic currently spread across handlers.

## Termination Rules

The Lambda execution can be safely terminated when:

1. ✅ **Checkpoint queue is empty** - No pending checkpoint operations
2. ✅ **Checkpoint is not processing** - No active checkpoint API call in flight
3. ✅ **No pending force checkpoint promises** - All force checkpoint requests completed
4. ✅ **No operations in EXECUTING state** - No user code currently running

All other operation states are safe to terminate because the backend will reinvoke the Lambda when needed:

- `RETRY_WAITING` - Backend reinvokes when retry timer expires
- `IDLE_NOT_AWAITED` - Backend reinvokes when external event occurs (wait timer, callback, invoke completion)
- `IDLE_AWAITED` - Backend reinvokes when external event occurs
- `COMPLETED` - Operation finished, no reinvocation needed

**Key Insight:** We only block termination when user code is executing (`EXECUTING` state) or when checkpoint operations are in progress. The backend handles all other cases by reinvoking the Lambda at the appropriate time.

## Current Architecture Problems

1. **Distributed Termination Logic**: Each handler independently decides when to terminate
2. **Duplicated Code**: `hasRunningOperations()` and `waitBeforeContinue()` logic repeated across handlers
3. **Complex State Tracking**: Operation state scattered across handlers, checkpoint, and context
4. **Difficult to Debug**: No central view of why termination did/didn't happen

## Proposed Architecture

### Core Components

```
┌─────────────────┐
│    Handlers     │ (step, wait, invoke, callback, etc.)
│  (DurablePromise)│
└────────┬────────┘
         │ notify lifecycle events + persist state
         ▼
┌─────────────────┐
│   Checkpoint    │ Persists operation state + tracks lifecycle
│   (Enhanced)    │ + manages timers + decides termination
└─────────────────┘
```

**Key Change:** Instead of creating a separate `OperationCoordinator`, we enhance the existing `Checkpoint` interface to include operation lifecycle management and termination logic.

### Operation States

```typescript
enum OperationLifecycleState {
  EXECUTING, // Running user code (step function, waitForCondition check)
  RETRY_WAITING, // Waiting for retry timer, will re-execute user code (phase 1)
  IDLE_NOT_AWAITED, // Waiting for external event, not awaited yet (phase 1)
  IDLE_AWAITED, // Waiting for external event, awaited (phase 2)
  COMPLETED, // Operation finished (success or permanent failure)
}
```

### Operation Types by Execution Pattern

| Operation            | Executes User Code? | Retry Logic?    | Phase 1 Behavior        | Phase 2 Behavior     |
| -------------------- | ------------------- | --------------- | ----------------------- | -------------------- |
| **step**             | ✅ Yes              | ✅ Yes          | Execute + retry loop    | Return cached result |
| **waitForCondition** | ✅ Yes              | ✅ Yes          | Check + retry loop      | Return cached result |
| **wait**             | ❌ No               | ❌ No           | Mark idle, return       | Wait for timer       |
| **invoke**           | ❌ No               | ❌ No           | Start invoke, return    | Wait for completion  |
| **callback**         | ❌ No               | ❌ No           | Create callback, return | Wait for completion  |
| **map/parallel**     | ✅ Via children     | ✅ Via children | Execute children        | Return cached result |

## Two-Phase Execution Pattern

### Operations That Execute User Code (step, waitForCondition)

**Phase 1: Execute with Retry Loop**

```typescript
const phase1Promise = (async () => {
  // Register operation on first call
  checkpoint.markOperationState(stepId, OperationLifecycleState.EXECUTING, {
    metadata: { stepId, name, type, subType, parentId },
  });

  while (true) {
    const status = context.getStepData(stepId)?.Status;

    // Check cached status first
    if (status === SUCCEEDED) {
      checkpoint.markOperationState(stepId, OperationLifecycleState.COMPLETED);
      return cachedResult;
    }

    if (status === FAILED) {
      checkpoint.markOperationState(stepId, OperationLifecycleState.COMPLETED);
      throw cachedError;
    }

    // Status is PENDING (retry scheduled)
    if (status === PENDING) {
      checkpoint.markOperationState(
        stepId,
        OperationLifecycleState.RETRY_WAITING,
        {
          endTimestamp: stepData.NextAttemptTimestamp,
        },
      );

      await checkpoint.waitForRetryTimer(stepId);
      // Timer expired, continue to execute
    }

    // Execute user code
    checkpoint.markOperationState(stepId, OperationLifecycleState.EXECUTING);
    try {
      const result = await executeUserCode();

      await checkpoint.checkpoint(stepId, {
        Action: SUCCEED,
        Payload: result,
      });

      checkpoint.markOperationState(stepId, OperationLifecycleState.COMPLETED);
      return result;
    } catch (error) {
      const retryDecision = retryStrategy(error, attempt);

      if (!retryDecision.shouldRetry) {
        // Permanent failure
        await checkpoint.checkpoint(stepId, {
          Action: FAIL,
          Error: error,
        });

        checkpoint.markOperationState(
          stepId,
          OperationLifecycleState.COMPLETED,
        );
        throw error;
      }

      // Schedule retry
      await checkpoint.checkpoint(stepId, {
        Action: RETRY,
        StepOptions: { NextAttemptDelaySeconds: delay },
      });

      // Loop continues to PENDING check above
      continue;
    }
  }
})();

phase1Promise.catch(() => {}); // Prevent unhandled rejection
```

**Phase 2: Return Phase 1 Result**

```typescript
return new DurablePromise(async () => {
  return await phase1Promise; // Just return phase 1 result
});
```

### Operations That Don't Execute User Code (wait, invoke, callback)

**Phase 1: Start Operation, Mark Idle**

```typescript
const phase1Promise = (async () => {
  checkpoint.markOperationState(stepId, OperationLifecycleState.EXECUTING, {
    metadata: { stepId, name, type, subType, parentId },
  });

  const status = context.getStepData(stepId)?.Status;

  // Check cached status
  if (status === SUCCEEDED) {
    checkpoint.markOperationState(stepId, OperationLifecycleState.COMPLETED);
    return cachedResult;
  }

  if (status === FAILED) {
    checkpoint.markOperationState(stepId, OperationLifecycleState.COMPLETED);
    throw cachedError;
  }

  // Operation not started yet
  if (!status) {
    await checkpoint.checkpoint(stepId, {
      Action: START,
      // ... operation-specific options
    });
  }

  // Mark as idle (not awaited yet)
  checkpoint.markOperationState(
    stepId,
    OperationLifecycleState.IDLE_NOT_AWAITED,
    {
      endTimestamp: stepData.ScheduledEndTimestamp, // for wait
      // no endTimestamp for callback/invoke
    },
  );

  return; // Phase 1 completes without waiting
})();

phase1Promise.catch(() => {});
```

**Phase 2: Wait for Completion**

```typescript
return new DurablePromise(async () => {
  await phase1Promise; // Wait for phase 1

  while (true) {
    const status = context.getStepData(stepId)?.Status;

    if (status === SUCCEEDED) {
      checkpoint.markOperationState(stepId, OperationLifecycleState.COMPLETED);
      return cachedResult;
    }

    if (status === FAILED || status === TIMED_OUT) {
      checkpoint.markOperationState(stepId, OperationLifecycleState.COMPLETED);
      throw cachedError;
    }

    // Transition to IDLE_AWAITED and wait for status change
    checkpoint.markOperationState(
      stepId,
      OperationLifecycleState.IDLE_AWAITED,
      {
        endTimestamp: stepData.ScheduledEndTimestamp,
      },
    );

    await checkpoint.waitForStatusChange(stepId);

    // Status changed, loop to check new status
  }
});
```

## Enhanced Checkpoint Interface

```typescript
interface OperationMetadata {
  stepId: string;
  name?: string;
  type: OperationType;
  subType: OperationSubType;
  parentId?: string;
}

interface Checkpoint {
  // ===== Existing Methods (Persistence) =====
  checkpoint(stepId: string, data: Partial<OperationUpdate>): Promise<void>;
  forceCheckpoint?(): Promise<void>;
  force?(): Promise<void>;
  setTerminating?(): void;
  hasPendingAncestorCompletion?(stepId: string): boolean;
  waitForQueueCompletion(): Promise<void>;

  // ===== New Methods (Lifecycle & Termination) =====

  // Single method to update operation state
  markOperationState(
    stepId: string,
    state: OperationLifecycleState,
    options?: {
      metadata?: OperationMetadata; // Required on first call (EXECUTING state)
      endTimestamp?: Date; // For RETRY_WAITING, IDLE_NOT_AWAITED, IDLE_AWAITED
    },
  ): void;

  // Waiting operations
  waitForRetryTimer(stepId: string): Promise<void>;
  waitForStatusChange(stepId: string): Promise<void>;

  // Mark operation as awaited (IDLE_NOT_AWAITED → IDLE_AWAITED)
  markOperationAwaited(stepId: string): void;

  // Query
  getOperationState(stepId: string): OperationLifecycleState | undefined;
  getAllOperations(): Map<string, OperationInfo>;

  // Cleanup (internal, called automatically)
  // - cleanupOperation(stepId): Clean up single operation
  // - cleanupAllOperations(): Clean up all operations (during termination)
}

interface OperationInfo {
  stepId: string;
  state: OperationLifecycleState;
  metadata: OperationMetadata;
  endTimestamp?: Date;
  timer?: NodeJS.Timeout;
  resolver?: () => void;
}
```

**Note:** The `checkAndTerminate()` method is internal to the Checkpoint implementation and called automatically when operation states change.

```

## Enhanced Checkpoint Implementation Details

The existing `CheckpointManager` class will be enhanced to include operation lifecycle tracking and termination logic.

### State Transitions

```

STARTED
↓
EXECUTING ←──────────┐
↓ │
├─→ RETRY_WAITING ─┘ (retry loop in phase 1)
├─→ IDLE_NOT_AWAITED (phase 1 complete, not awaited)
│ ↓
│ IDLE_AWAITED (phase 2, awaited)
↓
COMPLETED (cleanup triggered)

````

### Implementation Notes

**markOperationState Implementation:**
```typescript
markOperationState(
  stepId: string,
  state: OperationLifecycleState,
  options?: { metadata?: OperationMetadata, endTimestamp?: Date }
): void {
  let op = this.operations.get(stepId);

  if (!op) {
    // First call - create operation
    if (!options?.metadata) {
      throw new Error('metadata required on first call');
    }
    op = {
      stepId,
      state,
      metadata: options.metadata,
      endTimestamp: options.endTimestamp,
    };
    this.operations.set(stepId, op);
  } else {
    // Update existing operation
    op.state = state;
    if (options?.endTimestamp !== undefined) {
      op.endTimestamp = options.endTimestamp;
    }
  }

  // CLEANUP: If transitioning to COMPLETED, clean up resources
  if (state === OperationLifecycleState.COMPLETED) {
    this.cleanupOperation(stepId);
  }

  // Check if we should terminate
  this.checkAndTerminate();
}
````

### State Transitions

```
STARTED
  ↓
EXECUTING ←──────────┐
  ↓                  │
  ├─→ RETRY_WAITING ─┘ (retry loop in phase 1)
  ├─→ IDLE_NOT_AWAITED (phase 1 complete, not awaited)
  │     ↓
  │   IDLE_AWAITED (phase 2, awaited)
  ↓
COMPLETED
```

### Termination Decision Logic

```typescript
checkAndTerminate(): void {
  // Rule 1: Can't terminate if checkpoint queue is not empty
  if (this.queue.length > 0) {
    log("Cannot terminate: checkpoint queue not empty", { queueLength: this.queue.length });
    return;
  }

  // Rule 2: Can't terminate if checkpoint is currently processing
  if (this.isProcessing) {
    log("Cannot terminate: checkpoint processing in progress");
    return;
  }

  // Rule 3: Can't terminate if there are pending force checkpoint promises
  if (this.forceCheckpointPromises.length > 0) {
    log("Cannot terminate: pending force checkpoint promises", { count: this.forceCheckpointPromises.length });
    return;
  }

  const allOps = Array.from(this.operations.values());

  // Rule 4: Can't terminate if any operation is EXECUTING
  // (Backend cannot reinvoke while user code is running)
  const hasExecuting = allOps.some(op =>
    op.state === OperationLifecycleState.EXECUTING
  );

  if (hasExecuting) {
    log("Cannot terminate: operations executing user code");
    return;
  }

  // All other states are safe to terminate:
  // - RETRY_WAITING: Backend will reinvoke when retry timer expires
  // - IDLE_NOT_AWAITED: Backend will reinvoke when event occurs
  // - IDLE_AWAITED: Backend will reinvoke when event occurs
  // - COMPLETED: Operation finished

  // Determine if we should terminate and why
  const hasWaiting = allOps.some(op =>
    op.state === OperationLifecycleState.RETRY_WAITING ||
    op.state === OperationLifecycleState.IDLE_NOT_AWAITED ||
    op.state === OperationLifecycleState.IDLE_AWAITED
  );

  if (hasWaiting) {
    const reason = this.determineTerminationReason(allOps);
    log("Terminating execution", { reason, operationStates: allOps.map(op => op.state) });
    this.terminate(reason);
  } else {
    // All completed, no termination needed (normal completion)
    log("All operations completed, no termination needed");
  }
}

private determineTerminationReason(ops: OperationInfo[]): TerminationReason {
  // Find the operation that should trigger termination
  // Priority: RETRY_SCHEDULED > WAIT_SCHEDULED > CALLBACK_PENDING

  if (ops.some(op =>
    op.state === OperationLifecycleState.RETRY_WAITING &&
    op.metadata.subType === OperationSubType.STEP
  )) {
    return TerminationReason.RETRY_SCHEDULED;
  }

  if (ops.some(op =>
    (op.state === OperationLifecycleState.IDLE_NOT_AWAITED || op.state === OperationLifecycleState.IDLE_AWAITED) &&
    op.metadata.subType === OperationSubType.WAIT
  )) {
    return TerminationReason.WAIT_SCHEDULED;
  }

  return TerminationReason.CALLBACK_PENDING;
}

private terminate(reason: TerminationReason): void {
  log("🛑", "Terminating execution", { reason });

  // CLEANUP: Clear all timers and resolvers before terminating
  this.cleanupAllOperations();

  // Call termination manager
  this.terminationManager.terminate({ reason });
}
```

### Timer Management

**Key Principle: Backend Controls Status Changes**

All status changes come from the backend. The checkpoint manager's role is to:

1. **Wait for the appropriate time** (timer expiry or polling interval)
2. **Call `forceCheckpoint()`** to refresh state from backend
3. **Check if status changed** for the operation
4. **Resolve the promise** if status changed, otherwise **poll again in 5 seconds**

**Unified Logic for All Operations:**

- Operations with timestamp (retry, wait, waitForCondition): Wait until timestamp, then poll every 5s
- Operations without timestamp (callback, invoke): Start polling immediately (now + 1s), then every 5s

**Flow Diagram:**

```
Handler calls waitForRetryTimer(stepId) or waitForStatusChange(stepId)
  ↓
Checkpoint starts timer:
  - If endTimestamp exists: wait until endTimestamp
  - If no endTimestamp: wait 1 second (immediate polling)
  ↓
Timer expires
  ↓
Checkpoint calls forceCheckpoint() ← Calls backend API
  ↓
Backend returns updated execution state
  ↓
Checkpoint updates stepData from response
  ↓
Checkpoint checks: did status change for stepId?
  ↓
  ├─ YES → Resolve promise, handler continues
  └─ NO  → Schedule another force refresh in 5 seconds, repeat
```

```typescript
waitForRetryTimer(stepId: string): Promise<void> {
  const op = this.operations.get(stepId);
  if (!op) throw new Error(`Operation ${stepId} not found`);

  if (op.state !== OperationLifecycleState.RETRY_WAITING) {
    throw new Error(`Operation ${stepId} must be in RETRY_WAITING state`);
  }

  // Start timer - will poll after endTimestamp expires
  this.startTimerWithPolling(stepId, op.endTimestamp);

  return new Promise((resolve) => {
    op.resolver = resolve;
  });
}

waitForStatusChange(stepId: string): Promise<void> {
  const op = this.operations.get(stepId);
  if (!op) throw new Error(`Operation ${stepId} not found`);

  if (op.state !== OperationLifecycleState.IDLE_AWAITED) {
    throw new Error(`Operation ${stepId} must be in IDLE_AWAITED state`);
  }

  // Start timer - will poll after endTimestamp (or immediately if no timestamp)
  this.startTimerWithPolling(stepId, op.endTimestamp);

  return new Promise((resolve) => {
    op.resolver = resolve;
  });
}

private startTimerWithPolling(stepId: string, endTimestamp?: Date): void {
  const op = this.operations.get(stepId);
  if (!op) return;

  let delay: number;

  if (endTimestamp) {
    // Wait until endTimestamp
    delay = Math.max(0, endTimestamp.getTime() - Date.now());
  } else {
    // No timestamp, start polling immediately (1 second delay)
    delay = 1000;
  }

  op.timer = setTimeout(() => {
    this.forceRefreshAndCheckStatus(stepId);
  }, delay);
}

private async forceRefreshAndCheckStatus(stepId: string): Promise<void> {
  const op = this.operations.get(stepId);
  if (!op) return;

  // Get old status before refresh
  const oldStatus = this.context.getStepData(stepId)?.Status;

  // Force checkpoint to refresh state from backend
  await this.forceCheckpoint();

  // Get new status after refresh
  const newStatus = this.context.getStepData(stepId)?.Status;

  // Check if status changed
  if (newStatus !== oldStatus) {
    // Status changed, resolve the waiting promise
    op.resolver?.();
    op.resolver = undefined;

    // CLEANUP: Clear timer to stop polling
    if (op.timer) {
      clearTimeout(op.timer);
      op.timer = undefined;
    }
  } else {
    // Status not changed yet, poll again in 5 seconds
    op.timer = setTimeout(() => {
      this.forceRefreshAndCheckStatus(stepId);
    }, 5000);
  }
}

/**
 * Clean up operation resources (timers, resolvers)
 * Called when operation completes or is cancelled
 */
private cleanupOperation(stepId: string): void {
  const op = this.operations.get(stepId);
  if (!op) return;

  // Clear any active timer
  if (op.timer) {
    clearTimeout(op.timer);
    op.timer = undefined;
  }

  // Clear resolver
  op.resolver = undefined;
}

/**
 * Clean up all operations (called during termination)
 */
private cleanupAllOperations(): void {
  for (const [stepId, op] of this.operations.entries()) {
    if (op.timer) {
      clearTimeout(op.timer);
      op.timer = undefined;
    }
    op.resolver = undefined;
  }
}
```

### Cleanup Triggers

Cleanup happens in several scenarios:

1. **Status Changed (Normal Flow)**

   ```typescript
   if (newStatus !== oldStatus) {
     op.resolver?.();
     op.resolver = undefined;
     clearTimeout(op.timer); // ← Cleanup
     op.timer = undefined;
   }
   ```

2. **Operation Completed**

   ```typescript
   checkpoint.markOperationState(stepId, OperationLifecycleState.COMPLETED);
   // ↓ Automatically triggers cleanup
   this.cleanupOperation(stepId);
   ```

3. **Termination (CRITICAL)**

   ```typescript
   private terminate(reason: TerminationReason): void {
     // CLEANUP ALL: Clear all timers and resolvers before terminating
     this.cleanupAllOperations();

     // Then terminate
     this.terminationManager.terminate({ reason });
   }
   ```

   **Why this is critical:**
   - Lambda is about to terminate
   - All pending timers must be cleared
   - All pending promises must be cleaned up
   - Prevents timer leaks and memory leaks
   - Ensures clean shutdown

4. **Error/Exception**
   ```typescript
   try {
     await checkpoint.waitForStatusChange(stepId);
   } catch (error) {
     this.cleanupOperation(stepId); // ← Cleanup on error
     throw error;
   }
   ```

````

### Event Handling

```typescript
constructor(
  private context: ExecutionContext,
  private checkpoint: Checkpoint,
  private terminationManager: TerminationManager,
) {
  // Listen for checkpoint updates
  this.context.operationsEmitter.on(STEP_DATA_UPDATED_EVENT, (stepId: string) => {
    this.handleStatusChange(stepId);
  });
}

private handleStatusChange(stepId: string): void {
  const op = this.operations.get(stepId);
  if (!op) return;

  const newStatus = this.context.getStepData(stepId)?.Status;

  // Resolve waiting promise if status changed
  if (op.resolver && newStatus !== op.metadata.status) {
    op.metadata.status = newStatus;
    op.resolver();
    op.resolver = undefined;

    // Clear timer if exists
    if (op.timer) {
      clearTimeout(op.timer);
      op.timer = undefined;
    }
  }

  // Check if we can terminate
  this.checkAndTerminate();
}
````

## Migration Strategy

### Phase 1: Enhance Checkpoint Interface

1. Add new methods to `Checkpoint` interface (backward compatible)
2. Enhance `CheckpointManager` implementation with lifecycle tracking
3. Add comprehensive unit tests for new functionality
4. Existing handlers continue to work (don't use new methods yet)

### Phase 2: Migrate One Handler (wait)

1. Create `wait-handler-v2.ts` using enhanced checkpoint methods
2. Add integration tests comparing v1 vs v2 behavior
3. Run both in parallel, verify identical behavior
4. Switch to v2, keep v1 as backup

### Phase 3: Migrate Remaining Handlers

1. Migrate in order: invoke → callback → step → waitForCondition
2. Each handler gets `-v2.ts` file
3. Test thoroughly before removing old version

### Phase 4: Cleanup

1. Remove old handler files
2. Remove `hasRunningOperations()` and `waitBeforeContinue()` helpers
3. Remove old checkpoint methods if no longer needed
4. Update documentation

## Testing Strategy

### Unit Tests

- OperationCoordinator state transitions
- Timer management (mock timers)
- Termination decision logic
- Event handling

### Integration Tests

- Each handler with OperationCoordinator
- Nested contexts (parent-child operations)
- Concurrent operations (map, parallel)
- Error cases (checkpoint failures, timeouts)

### Comparison Tests

- Run same workflow with v1 and v2 handlers
- Verify identical checkpoint calls
- Verify identical termination behavior
- Verify identical timing

## Benefits

1. **Centralized Logic**: Single source of truth for termination decisions
2. **Better Observability**: Complete view of all operations and their states
3. **Optimized Timers**: Checkpoint can batch force-refresh calls
4. **Simpler Handlers**: Handlers just notify lifecycle events
5. **Easier Testing**: Can test checkpoint independently
6. **Consistent Behavior**: All handlers follow same pattern
7. **No New Abstraction**: Enhances existing Checkpoint instead of adding new layer
8. **Natural Fit**: Checkpoint already manages operation state, now also manages lifecycle
9. **Eliminates Redundancy**: Removes `runningOperations` and `activeOperationsTracker` in favor of unified state tracking

## Systems Being Removed

The centralized design eliminates redundant tracking systems:

### `runningOperations` (DurableContext)

**Current Purpose:** Tracks operations executing user code (per-context Set)
**Replacement:** Operation state tracking with `EXECUTING` state
**Migration:**

- Handlers call `checkpoint.markOperationState(stepId, OperationLifecycleState.EXECUTING)` instead of `addRunningOperation(stepId)`
- Handlers call `checkpoint.markOperationState(stepId, OperationLifecycleState.COMPLETED)` instead of `removeRunningOperation(stepId)`
- Termination checks `getAllOperations()` for EXECUTING state instead of `hasRunningOperations()`

### `activeOperationsTracker` (ExecutionContext)

**Current Purpose:** Tracks in-flight checkpoint operations (global counter)
**Replacement:** Checkpoint queue status checks
**Migration:**

- Remove `activeOperationsTracker.increment()` / `decrement()` calls from `CheckpointManager.checkpoint()`
- Termination checks `isProcessing`, `queue.length`, `forceCheckpointPromises.length` instead of `activeOperationsTracker.hasActive()`
- Remove polling-based deferral in `terminate()` helper - checkpoint decides when to terminate

### `waitBeforeContinue()` (Utility Function)

**Current Purpose:** Waits for multiple conditions (operations complete, status change, timer expiry, awaited change)
**Replacement:** Checkpoint methods (`waitForStatusChange`, `waitForRetryTimer`)
**Migration:**

- Handlers call `checkpoint.waitForStatusChange(stepId)` instead of `waitBeforeContinue({ checkStepStatus: true, ... })`
- Handlers call `checkpoint.waitForRetryTimer(stepId)` instead of `waitBeforeContinue({ checkTimer: true, ... })`
- Checkpoint internally manages timers, events, force refresh
- Delete `waitBeforeContinue()` utility after all handlers migrated

### `terminate()` (Helper Function)

**Current Purpose:** Defers termination until checkpoint operations complete, then calls `terminationManager.terminate()`
**Replacement:** Checkpoint automatic termination decision
**Migration:**

- Remove `terminate()` calls from handlers
- Handlers just return or wait for checkpoint methods
- Checkpoint automatically calls `terminationManager.terminate()` when conditions are met
- Delete `terminate()` helper after all handlers migrated

### `onAwaitedChange` Callback Pattern

**Current Purpose:** Manual callback to notify when DurablePromise is awaited (IDLE_NOT_AWAITED → IDLE_AWAITED transition)
**Replacement:** DurablePromise automatic notification
**Migration:**

- DurablePromise constructor takes `stepId` and `checkpoint` parameters
- DurablePromise automatically calls `checkpoint.markOperationAwaited(stepId)` when awaited
- Remove manual callback passing from handlers
- Remove `onAwaitedChange` parameter from `waitBeforeContinue()` (which will be deleted anyway)

### Why These Can Be Removed

- **`runningOperations`**: Enhanced Checkpoint tracks operation states, including EXECUTING state which indicates user code is running
- **`activeOperationsTracker`**: Checkpoint already has `isProcessing` flag and queue lengths, which provide the same information
- **`waitBeforeContinue()`**: Enhanced Checkpoint provides `waitForStatusChange()` and `waitForRetryTimer()` methods that handle all the same logic internally
- **`terminate()`**: Enhanced Checkpoint automatically decides when to terminate based on operation states and queue status, then calls `terminationManager.terminate()` directly
- **`onAwaitedChange`**: DurablePromise can automatically notify Checkpoint when awaited, eliminating manual callback pattern
- **Result**: Single source of truth for all operation lifecycle and termination decisions, with cleaner handler code

## Benefits

1. **Centralized Logic**: Single source of truth for termination decisions
2. **Better Observability**: Complete view of all operations and their states
3. **Optimized Timers**: Checkpoint can batch force-refresh calls
4. **Simpler Handlers**: Handlers just notify lifecycle events
5. **Easier Testing**: Can test checkpoint independently
6. **Consistent Behavior**: All handlers follow same pattern
7. **No New Abstraction**: Enhances existing Checkpoint instead of adding new layer
8. **Natural Fit**: Checkpoint already manages operation state, now also manages lifecycle

## Risks and Mitigations

| Risk                            | Mitigation                                          |
| ------------------------------- | --------------------------------------------------- |
| Coordinator becomes too complex | Keep interface simple, delegate to helper classes   |
| Behavioral differences from v1  | Comprehensive comparison tests                      |
| Performance regression          | Benchmark timer management, optimize if needed      |
| Hard to debug                   | Add detailed logging, operation state visualization |
| Migration takes too long        | Migrate one handler at a time, keep old code        |

## Open Questions

1. **Should checkpoint manage activeOperationsTracker?**
   - Currently tracks operations executing user code
   - Checkpoint already tracks EXECUTING state
   - Could merge into checkpoint

2. **How to handle child contexts?**
   - Each child context has its own checkpoint instance?
   - Or single checkpoint tracks parent-child relationships?
   - Need to prevent termination if child is active

3. **Should checkpoint emit events?**
   - `operation:state-changed`
   - `all-operations-idle`
   - For observability and testing

4. **How to handle replay mode?**
   - Checkpoint behavior in replay vs execution mode
   - Should checkpoint track replay state?
   - Lifecycle tracking might be execution-mode only

5. **Backward compatibility?**
   - Keep old checkpoint methods for gradual migration?
   - Or break compatibility and update all handlers at once?
   - Recommend: Keep old methods, mark as deprecated

## Next Steps

1. Review and approve this design document
2. Enhance `Checkpoint` interface with new methods
3. Enhance `CheckpointManager` implementation with lifecycle tracking
4. Write comprehensive unit tests for new functionality
5. Migrate wait handler as proof of concept
6. Iterate based on learnings

## Why Enhance Checkpoint Instead of New Coordinator?

**Advantages:**

- ✅ **No new abstraction**: Checkpoint already exists and is well understood
- ✅ **Natural fit**: Checkpoint already manages operation state persistence
- ✅ **Single responsibility**: One component for all operation state (persisted + runtime)
- ✅ **Simpler architecture**: Fewer moving parts
- ✅ **Easier migration**: Handlers already have checkpoint reference
- ✅ **Backward compatible**: Can add new methods without breaking existing code

**Considerations:**

- ⚠️ **Checkpoint becomes larger**: More responsibilities (persistence + lifecycle + termination)
- ⚠️ **Testing complexity**: Need to test both persistence and lifecycle logic
- ⚠️ **Naming**: "Checkpoint" might not reflect full responsibilities anymore

**Mitigation:**

- Keep implementation modular: `CheckpointManager` delegates to helper classes
  - `CheckpointPersistence` - handles API calls
  - `OperationLifecycle` - handles state tracking
  - `TerminationDecider` - handles termination logic
- Consider renaming to `OperationManager` in future major version
- For now, enhance existing `Checkpoint` interface and implementation
