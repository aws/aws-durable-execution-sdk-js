import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const client = new LambdaClient({});
const FUNCTION_NAME = process.env.TARGET_FUNCTION_NAME!;

const CUSTOMERS = [
  "Alice Johnson",
  "Bob Martinez",
  "Carol Williams",
  "David Chen",
  "Emma Thompson",
  "Frank O'Brien",
  "Grace Kim",
  "Henry Patel",
];

const CLAIM_TYPES = [
  "auto-collision",
  "auto-theft",
  "home-fire",
  "home-flood",
  "home-burglary",
  "health-emergency",
  "health-routine",
  "life-disability",
  "travel-cancellation",
  "travel-medical",
];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomClaimNumber(): string {
  const prefix = "CLM";
  const year = new Date().getFullYear();
  const seq = Math.floor(Math.random() * 900000) + 100000;
  return `${prefix}-${year}-${seq}`;
}

function randomAmount(type: string): number {
  const ranges: Record<string, [number, number]> = {
    "auto-collision": [2000, 45000],
    "auto-theft": [5000, 60000],
    "home-fire": [10000, 250000],
    "home-flood": [5000, 150000],
    "home-burglary": [1000, 50000],
    "health-emergency": [500, 100000],
    "health-routine": [100, 5000],
    "life-disability": [10000, 500000],
    "travel-cancellation": [200, 15000],
    "travel-medical": [500, 75000],
  };
  const [min, max] = ranges[type] ?? [1000, 50000];
  return Math.round((Math.random() * (max - min) + min) * 100) / 100;
}

export async function handler() {
  const claimType = randomItem(CLAIM_TYPES);
  const payload = {
    customerName: randomItem(CUSTOMERS),
    insuranceClaimNumber: randomClaimNumber(),
    claimAmount: randomAmount(claimType),
    claimType,
  };

  console.log(`Dispatching to ${FUNCTION_NAME}:`, JSON.stringify(payload));

  await client.send(
    new InvokeCommand({
      FunctionName: FUNCTION_NAME,
      InvocationType: "Event", // async — don't wait for result
      Payload: Buffer.from(JSON.stringify(payload)),
    }),
  );

  return { dispatched: payload };
}
