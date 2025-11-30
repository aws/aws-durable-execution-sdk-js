# Naming Update: OperationState → OperationLifecycleState

## Change Summary

**Old Name:** `OperationState`
**New Name:** `OperationLifecycleState`

## Reason for Change

Avoid confusion with AWS SDK's `OperationStatus` enum (PENDING, SUCCEEDED, FAILED, etc.)

## What Changed

### Enum Definition

```typescript
// Before
enum OperationState {
  EXECUTING,
  RETRY_WAITING,
  IDLE_NOT_AWAITED,
  IDLE_AWAITED,
  COMPLETED,
}

// After
enum OperationLifecycleState {
  EXECUTING,
  RETRY_WAITING,
  IDLE_NOT_AWAITED,
  IDLE_AWAITED,
  COMPLETED,
}
```

### Method Signatures (Unchanged - Stay Concise)

```typescript
interface Checkpoint {
  // Method names stay simple
  markOperationState(stepId: string, state: OperationLifecycleState, ...): void;
  getOperationState(stepId: string): OperationLifecycleState | undefined;
}
```

### Usage

```typescript
// Clear distinction from AWS SDK's OperationStatus
checkpoint.markOperationState(stepId, OperationLifecycleState.EXECUTING, { ... });

// vs AWS SDK status
if (stepData.Status === OperationStatus.SUCCEEDED) { ... }
```

## Benefits

1. **Clear Distinction**: `OperationLifecycleState` vs `OperationStatus` - no confusion
2. **Descriptive**: Indicates this is about lifecycle tracking, not backend status
3. **Consistent**: Matches "operation lifecycle management" concept
4. **Concise Methods**: Method names stay short (`markOperationState`, not `markOperationLifecycleState`)

## Documents Updated

- ✅ `CENTRALIZED_TERMINATION_DESIGN.md`
- ✅ `CENTRALIZED_TERMINATION_ANALYSIS.md`
