import { Rule } from 'eslint';

export const noNestedDurableOperations: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow using the same context object inside its own durable operation',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      sameContextUsage: 'Cannot use the same context object "{{contextName}}" inside its own operation. Use runInChildContext for nested operations.',
    },
    schema: [],
  },
  create(context) {
    const durableOperations = new Set([
      'step',
      'wait',
      'waitForCallback',
      'waitForCondition',
      'parallel',
      'map',
      'runInChildContext'
    ]);

    let contextStack: string[] = [];

    function isDurableOperation(node: any): {operation: string, contextName: string} | null {
      if (
        node.callee &&
        node.callee.type === 'MemberExpression' &&
        node.callee.property &&
        node.callee.property.type === 'Identifier' &&
        durableOperations.has(node.callee.property.name) &&
        node.callee.object &&
        node.callee.object.type === 'Identifier'
      ) {
        return {
          operation: node.callee.property.name,
          contextName: node.callee.object.name
        };
      }
      return null;
    }

    return {
      CallExpression(node: any) {
        const durableOp = isDurableOperation(node);
        
        if (durableOp) {
          const { contextName } = durableOp;

          // Check if we're using the same context that's already on the stack
          if (contextStack.includes(contextName)) {
            context.report({
              node,
              messageId: 'sameContextUsage',
              data: {
                contextName,
              },
            });
          }

          // Add this context to the stack
          contextStack.push(contextName);
        }
      },
      'CallExpression:exit'(node: any) {
        const durableOp = isDurableOperation(node);
        if (durableOp && contextStack.length > 0) {
          contextStack.pop();
        }
      },
    };
  },
};
