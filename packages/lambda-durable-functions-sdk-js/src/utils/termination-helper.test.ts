import { terminate, terminateForUnrecoverableError } from './termination-helper';
import { ExecutionContext } from '../types';
import { UnrecoverableError } from '../errors/unrecoverable-error/unrecoverable-error';
import { TerminationReason } from '../termination-manager/types';

describe('termination helpers', () => {
  let mockContext: jest.Mocked<ExecutionContext>;

  beforeEach(() => {
    mockContext = {
      terminationManager: {
        terminate: jest.fn(),
      },
    } as any;
  });

  describe('terminate', () => {
    it('should terminate execution with correct parameters', () => {
      const reason = TerminationReason.CUSTOM;
      const message = 'Test termination message';
      
      terminate(mockContext, reason, message);

      expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CUSTOM,
        message: 'Test termination message',
      });
    });

    it('should return a never-resolving promise', () => {
      const reason = TerminationReason.RETRY_SCHEDULED;
      const message = 'Test message';
      
      const promise = terminate(mockContext, reason, message);

      expect(promise).toBeInstanceOf(Promise);
      
      let resolved = false;
      promise.then(() => { resolved = true; });
      
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(resolved).toBe(false);
          resolve();
        }, 0);
      });
    });

    it('should work with different termination reasons', () => {
      terminate(mockContext, TerminationReason.WAIT_SCHEDULED, 'Wait message');
      expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.WAIT_SCHEDULED,
        message: 'Wait message',
      });

      terminate(mockContext, TerminationReason.CALLBACK_PENDING, 'Callback message');
      expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CALLBACK_PENDING,
        message: 'Callback message',
      });
    });
  });

  describe('terminateForUnrecoverableError', () => {
    let mockError: UnrecoverableError;

    beforeEach(() => {
      mockError = {
        terminationReason: TerminationReason.CUSTOM,
        message: 'Test error message',
      } as UnrecoverableError;
    });

    it('should terminate execution with correct parameters for unrecoverable error', () => {
      const stepIdentifier = 'test-step';
      
      terminateForUnrecoverableError(mockContext, mockError, stepIdentifier);

      expect(mockContext.terminationManager.terminate).toHaveBeenCalledWith({
        reason: TerminationReason.CUSTOM,
        message: 'Unrecoverable error in step test-step: Test error message',
      });
    });

    it('should return a never-resolving promise', () => {
      const stepIdentifier = 'test-step';
      
      const promise = terminateForUnrecoverableError(mockContext, mockError, stepIdentifier);

      expect(promise).toBeInstanceOf(Promise);
      
      let resolved = false;
      promise.then(() => { resolved = true; });
      
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(resolved).toBe(false);
          resolve();
        }, 0);
      });
    });
  });
});
