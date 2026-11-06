import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "../lib/api";
import { errorMessage } from "../lib/format";
import type { Config } from "../lib/types";

interface ConfigContextValue {
  config: Config | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  save: (config: Config) => Promise<Config>;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setConfig(await api.config());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  const save = useCallback(async (next: Config) => {
    const saved = await api.saveConfig(next);
    setConfig(saved);
    return saved;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ config, loading, error, refresh, save }),
    [config, loading, error, refresh, save],
  );

  return (
    <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
  );
}

export function useConfig(): ConfigContextValue {
  const value = useContext(ConfigContext);
  if (value === null) {
    throw new Error("useConfig must be used inside ConfigProvider");
  }
  return value;
}
