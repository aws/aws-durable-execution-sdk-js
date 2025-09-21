import { noNestedDurableOperations } from './rules/no-nested-durable-operations';

export = {
  rules: {
    'no-nested-durable-operations': noNestedDurableOperations,
  },
  configs: {
    recommended: {
      plugins: ['@amzn/durable-functions'],
      rules: {
        '@amzn/durable-functions/no-nested-durable-operations': 'error',
      },
    },
  },
};
