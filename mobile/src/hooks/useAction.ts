import { useCallback, useState } from 'react';
import { errorMessage } from '../lib/format';
import type { PollPayload } from '../lib/types';
import { useLive } from '../context/LiveContext';
import { useToast } from '../context/ToastContext';

interface RunOptions {
  success?: string;
}

function isPollPayload(value: unknown): value is PollPayload {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<PollPayload>;
  return (
    candidate.state !== undefined &&
    candidate.checklist !== undefined &&
    Array.isArray(candidate.events)
  );
}

export function useAction() {
  const [pending, setPending] = useState(false);
  const { applyPayload } = useLive();
  const { push } = useToast();

  const run = useCallback(
    async (
      action: () => Promise<unknown>,
      options: RunOptions = {},
    ): Promise<boolean> => {
      setPending(true);
      try {
        const result = await action();
        if (isPollPayload(result)) {
          applyPayload(result);
        }
        if (options.success) {
          push({ kind: 'success', title: options.success });
        }
        return true;
      } catch (caught) {
        push({
          kind: 'error',
          title: 'Action failed',
          body: errorMessage(caught),
        });
        return false;
      } finally {
        setPending(false);
      }
    },
    [applyPayload, push],
  );

  return { pending, run };
}
