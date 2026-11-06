import { useCallback, useState } from "react";
import { errorMessage } from "../lib/format";
import { useToast } from "../context/ToastContext";

interface RunOptions {
  success?: string;
}

export function useAction() {
  const [pending, setPending] = useState(false);
  const { push } = useToast();

  const run = useCallback(
    async (action: () => Promise<unknown>, options: RunOptions = {}) => {
      setPending(true);
      try {
        await action();
        if (options.success) {
          push({ kind: "success", title: options.success });
        }
        return true;
      } catch (caught) {
        push({
          kind: "error",
          title: "Action failed",
          body: errorMessage(caught),
        });
        return false;
      } finally {
        setPending(false);
      }
    },
    [push],
  );

  return { pending, run };
}
