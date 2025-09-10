### POST getStepData

request parameters:

```
stepId?: string,
nextToken?: string,
maxResult?: number
```

response:

```
type StepType = 'run' | 'wait' | 'durablePromise' | 'invoke' | 'invokeAsync';

interface StepInfo {
    stepName: string;
    iterationKey: string;
    type: StepType;
    config: any;
    data: any;
    result: string;
    error: string;
    status: string;
}

interface getStepDataResponse {
    stepData: {
        [stepId: string]: StepInfo;
    };
    nextToken: string;
}

```

### POST checkpoint

request parameters:

```
stepId?: string,
taskToken: string,
stepName: string;
type: StepType;
config?: any; // Only the initial checkpoint for each step needs config
result: string;
error: string;
status: string;
```

response:

```
    taskToken: string // new task token to use in next checkpoint call
```
