# Step Handler Flowchart

```mermaid
---
title: Step Handler Flow
---
flowchart TD
    subgraph Main["Main Step Handler Flow"]
        direction TB
        A[Step Handler Called] --> B[Parse Parameters]
        B --> C[Generate Step ID]
        C --> D[Start Main Loop]
        
        D --> E{Step Status?}
        
        E -->|SUCCEEDED| F[Return Cached Result]
        E -->|FAILED| G[Throw Error]
        E -->|PENDING| H[waitForContinuation]
        E -->|STARTED| I{Semantics Check}
        E -->|READY/undefined| J[executeStep]
        
        I -->|AtMostOncePerRetry| K[Handle Interrupted Step]
        I -->|AtLeastOncePerRetry| L[executeStep]
        
        K --> M{Should Retry?}
        M -->|No| N[Checkpoint FAIL & Throw Error]
        M -->|Yes| O[Checkpoint RETRY]
        O --> P[waitForContinuation]
        P --> Q[Continue Loop]
        Q --> E
        
        H --> R[Continue Loop]
        R --> E
        
        J --> S{executeStep Result}
        S -->|Success| T[Return Result]
        S -->|Continue Signal| U[Continue Loop]
        U --> E
        
        L --> V{executeStep Result}
        V -->|Success| W[Return Result]
        V -->|Continue Signal| X[Continue Loop]
        X --> E
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
        II --> JJ[Return to Main Loop]
        
        GG --> JJ
        HH --> JJ
    end
    
    subgraph Execute["executeStep Subprocess"]
        direction TB
        KK[executeStep Called] --> LL{Already Started?}
        LL -->|No| MM[Checkpoint START]
        LL -->|Yes| NN[Skip Checkpoint]
        
        MM --> OO[Execute Function]
        NN --> OO
        
        OO --> PP{Execution Result}
        
        PP -->|Success| QQ[Serialize & Checkpoint SUCCEED]
        QQ --> RR[Return Result]
        
        PP -->|Error| SS{Unrecoverable Error?}
        SS -->|Yes| TT[Terminate for Unrecoverable Error]
        SS -->|No| UU[Apply Retry Strategy]
        
        UU --> VV{Should Retry?}
        VV -->|No| WW[Checkpoint FAIL & Throw Error]
        VV -->|Yes| XX[Checkpoint RETRY]
        XX --> YY[waitForContinuation]
        YY --> ZZ[Return Continue Signal]
    end
    
    style F fill:#90EE90
    style G fill:#FFB6C1
    style N fill:#FFB6C1
    style Q fill:#87CEEB
    style R fill:#87CEEB
    style T fill:#90EE90
    style U fill:#87CEEB
    style W fill:#90EE90
    style X fill:#87CEEB
    style AA fill:#FFE4B5
    style JJ fill:#87CEEB
    style RR fill:#90EE90
    style TT fill:#FF6B6B
    style WW fill:#FFB6C1
    style ZZ fill:#87CEEB
```

## waitForContinuation Detailed Logic

The expanded waitForContinuation subprocess now shows:

**1. Initial Check**: `Has Running Operations?`
- If no operations → immediate termination
- If operations exist → proceed to sophisticated waiting

**2. Promise Race Setup**: `Setup Promise Race`
- Creates multiple promises to monitor different conditions
- Uses `Promise.race()` to wait for first condition to resolve

**3. Three Monitoring Conditions**:
- **Timer Promise**: Waits for `NextAttemptTimestamp` to expire
- **Operations Promise**: Polls `hasRunningOperations()` every 100ms
- **Status Promise**: Polls step status changes every 100ms

**4. Condition Resolution**:
- **Timer Expired**: Forces checkpoint refresh to get latest data
- **No Running Operations**: Can safely return to main loop
- **Status Changed**: Step was updated externally, re-evaluate immediately
