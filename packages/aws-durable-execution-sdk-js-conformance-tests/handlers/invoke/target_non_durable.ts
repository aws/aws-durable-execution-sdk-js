// Target function that is NOT wrapped with withDurableExecution (plain Lambda handler)
export const handler = async (event: any) => {
  return "non_durable_result";
};
