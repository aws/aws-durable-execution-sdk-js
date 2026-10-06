/**
 * Reads the MicroVM settings that the integration test deploys with the
 * MicroVM examples. scripts/ensure-microvm-image.ts builds the image, and the
 * SAM template sets both variables on every example with `usesMicrovm`.
 */
export function requireMicrovmEnv(): {
  imageArn: string;
  executionRoleArn: string;
} {
  const imageArn = process.env.MICROVM_IMAGE_ARN;
  const executionRoleArn = process.env.MICROVM_EXECUTION_ROLE_ARN;
  if (!imageArn || !executionRoleArn) {
    throw new Error(
      "MICROVM_IMAGE_ARN and MICROVM_EXECUTION_ROLE_ARN must be set. " +
        "Build the image with scripts/ensure-microvm-image.ts.",
    );
  }
  return { imageArn, executionRoleArn };
}
