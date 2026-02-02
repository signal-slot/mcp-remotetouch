import type { ChildProcessWithoutNullStreams } from "node:child_process";

export interface SessionConfig {
  host: string;
  user: string;
  port: number;
  sshKey?: string;
  screenWidth: number;
  screenHeight: number;
  useSudo: boolean;
}

export interface TouchSession {
  id: string;
  config: SessionConfig;
  process: ChildProcessWithoutNullStreams | null;
  active: boolean;
  pending: {
    resolve: (value: DaemonResponse) => void;
    reject: (reason: Error) => void;
  } | null;
}

export type DaemonCommandType =
  | "init"
  | "tap"
  | "swipe"
  | "long_press"
  | "double_tap"
  | "shutdown";

export interface DaemonCommand {
  id: string;
  type: DaemonCommandType;
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
  duration_ms?: number;
  steps?: number;
  screen_width?: number;
  screen_height?: number;
}

export interface DaemonResponse {
  id: string;
  status: "ok" | "error" | "ready";
  message?: string;
}
