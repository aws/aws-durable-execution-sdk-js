# WaitForCondition Handler Flowchart

```mermaid
---
title: WaitForCondition Handler Flow
---
flowchart TD
    subgraph Main["Main WaitForCondition Handler Flow"]
        direction TB
        A[WaitForCondition Handler Called] --> B[Parse Parameters]
        B --> C[Validate Config]
        C --> D[Generate Step ID]
        D --> E[Start Main Loop]

        E --> F{Step Status?}

        F -->|SUCCEEDED| G[Return Cached Result]
        F -->|FAILED| H[Throw Error]
        F -->|PENDING| I[waitForContinuation]
        F -->|READY/STARTED/undefined| J[executeWaitForCondition]

        I --> K[Continue Loop]
        K --> F

        J --> L{executeWaitForCondition Result}
        L -->|Success| M[Return Result]
        L -->|Continue Signal| N[Continue Loop]
        N --> F
    end

    subgraph Timer["waitForContinuation Subprocess"]
        direction TB
        Y[waitForContinuation Called] --> Z{Has Running Operations?}

        Z -->|No| AA[Terminate with RETRY_SCHEDULED]
        Z -->|Yes| BB[Start waitBeforeContinue]

        BB --> CC[Setup Promise Race]
        CC --> DD[Monitor 3 Conditions Simultaneously]

        DD --> EE{Which Condition Resolves First?}

        EE -->|Timer Expired| FF[Timer Condition Met]
        EE -->|No Running Operations| GG[Operations Condition Met]
        EE -->|Step Status Changed| HH[Status Change Condition Met]

        FF --> II[Force Checkpoint Refresh]
        II --> JJ[Return to Handler]

        GG --> JJ
        HH --> JJ
    end

    subgraph Execute["executeWaitForCondition Subprocess"]
        direction TB
        KK[executeWaitForCondition Called] --> LL[Get Current State]
        LL --> MM{State Source?}

        MM -->|First Execution| NN[Use Initial State]
        MM -->|Retry/Ready| OO[Deserialize Checkpoint State]

        NN --> PP[Checkpoint START]
        OO --> PP

        PP --> QQ[Execute Check Function]
        QQ --> RR[Serialize New State]
        RR --> SS[Apply Wait Strategy]

        SS --> TT{Should Continue?}

        TT -->|No - Condition Met| UU[Checkpoint SUCCEED]
        UU --> VV[Return Final State]

        TT -->|Yes - Keep Waiting| WW[Checkpoint RETRY with Delay]
        WW --> XX[waitForContinuation]
        XX --> YY[Return Continue Signal]

        QQ --> ZZ{Check Function Error?}
        ZZ -->|Error| AAA[Checkpoint FAIL & Throw Error]
    end

    style G fill:#90EE90
    style H fill:#FFB6C1
    style K fill:#87CEEB
    style M fill:#90EE90
    style N fill:#87CEEB
    style AA fill:#FFE4B5
    style JJ fill:#87CEEB
    style VV fill:#90EE90
    style YY fill:#87CEEB
    style ZZ fill:#FFB6C1
```

## WaitForCondition Detailed Logic

The waitForCondition handler now implements the same main loop pattern as the step handler:

**1. Main Loop Pattern**:

- **while (true)** loop that re-evaluates step status after waiting
- **CONTINUE_MAIN_LOOP** symbol for flow control between executeWaitForCondition and main loop
- Enables proper handling of concurrent operations during retries

**2. Status-Based Flow**:

- **SUCCEEDED**: Returns cached final state
- **FAILED**: Throws error from previous attempt
- **PENDING**: Waits for scheduled retry using waitForContinuation, then continues loop
- **READY/STARTED/undefined**: Executes check function

**3. State Management**:

- **First Execution**: Uses `config.initialState`
- **Retry/Ready**: Deserializes state from previous checkpoint
- **State Evolution**: Check function transforms current state to new state

**4. Wait Strategy Decision**:

- Calls `config.waitStrategy(newState, attemptNumber)`
- Returns `{ shouldContinue: boolean, delay?: Duration }`
- **shouldContinue = false**: Condition met, complete successfully
- **shouldContinue = true**: Schedule retry with delay, return CONTINUE_MAIN_LOOP

**5. Concurrent Operations Support**:

- Uses same `waitForContinuation` logic as step handler
- Checks `hasRunningOperations()` before terminating
- Monitors timer, operations, and status changes simultaneously
- **Main Loop Re-evaluation**: After waitForContinuation, continues loop to re-check status

## Key Similarities with Step Handler

**Main Loop Pattern**:

- Both use `while (true)` loop for re-evaluation
- Both use `CONTINUE_MAIN_LOOP` symbol for flow control
- Both handle PENDING status with waitForContinuation → continue

**Concurrent Operations**:

- Identical `waitForContinuation` implementation
- Same Promise.race monitoring of timer/operations/status
- Same prevention of premature termination

**Flow Control**:

- Both can return to main loop after waiting
- Both re-evaluate step status after waitForContinuation
- Both handle race conditions in concurrent execution scenarios
