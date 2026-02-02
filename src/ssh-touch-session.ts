import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { SessionConfig, TouchSession, DaemonCommand, DaemonResponse } from "./types.js";
import { PYTHON_DAEMON_SCRIPT } from "./python-daemon.js";

const HANDSHAKE_TIMEOUT_MS = 15000;
const COMMAND_TIMEOUT_MS = 30000;

export class SshTouchSessionManager {
  private sessions = new Map<string, TouchSession>();

  async connect(config: SessionConfig): Promise<string> {
    const sessionId = randomUUID();
    const session: TouchSession = {
      id: sessionId,
      config,
      process: null,
      active: false,
      pending: null,
    };
    this.sessions.set(sessionId, session);

    const scriptBase64 = Buffer.from(PYTHON_DAEMON_SCRIPT).toString("base64");
    const pythonCmd = `python3 -u -c "import base64,sys;exec(base64.b64decode(sys.argv[1]))" "${scriptBase64}"`;
    const remoteCmd = config.useSudo ? `sudo ${pythonCmd}` : pythonCmd;

    const sshArgs: string[] = [
      "-T",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "BatchMode=yes",
      "-o", "ServerAliveInterval=15",
      "-o", "ServerAliveCountMax=3",
      "-p", String(config.port),
    ];
    if (config.sshKey) {
      sshArgs.push("-i", config.sshKey);
    }
    sshArgs.push(`${config.user}@${config.host}`, remoteCmd);

    const proc = spawn("ssh", sshArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    session.process = proc;

    const rl = createInterface({ input: proc.stdout });
    rl.on("line", (line: string) => {
      let resp: DaemonResponse;
      try {
        resp = JSON.parse(line);
      } catch {
        return;
      }
      if (session.pending) {
        const p = session.pending;
        session.pending = null;
        p.resolve(resp);
      }
    });

    let stderrBuf = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });

    proc.on("close", (code: number | null) => {
      session.active = false;
      if (session.pending) {
        const p = session.pending;
        session.pending = null;
        p.reject(new Error(`SSH process exited with code ${code}. stderr: ${stderrBuf.trim()}`));
      }
    });

    proc.on("error", (err: Error) => {
      session.active = false;
      if (session.pending) {
        const p = session.pending;
        session.pending = null;
        p.reject(err);
      }
    });

    // Send init command and wait for handshake
    const initCmd: DaemonCommand = {
      id: "init-" + sessionId,
      type: "init",
      screen_width: config.screenWidth,
      screen_height: config.screenHeight,
    };

    try {
      const resp = await this.sendCommandRaw(session, initCmd, HANDSHAKE_TIMEOUT_MS);
      if (resp.status === "error") {
        this.cleanup(session);
        throw new Error(`Daemon init failed: ${resp.message}`);
      }
      session.active = true;
    } catch (err) {
      this.cleanup(session);
      this.sessions.delete(sessionId);
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to connect to ${config.host}: ${msg}`);
    }

    return sessionId;
  }

  async sendCommand(sessionId: string, cmd: DaemonCommand): Promise<DaemonResponse> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    if (!session.active || !session.process) {
      throw new Error(`Session is not active: ${sessionId}`);
    }
    return this.sendCommandRaw(session, cmd, COMMAND_TIMEOUT_MS);
  }

  private sendCommandRaw(session: TouchSession, cmd: DaemonCommand, timeoutMs: number): Promise<DaemonResponse> {
    return new Promise<DaemonResponse>((resolve, reject) => {
      if (!session.process || !session.process.stdin.writable) {
        reject(new Error("SSH process stdin not writable"));
        return;
      }

      const timer = setTimeout(() => {
        if (session.pending) {
          session.pending = null;
          reject(new Error(`Command timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      session.pending = {
        resolve: (resp: DaemonResponse) => {
          clearTimeout(timer);
          resolve(resp);
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        },
      };

      const line = JSON.stringify(cmd) + "\n";
      session.process.stdin.write(line);
    });
  }

  async disconnect(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (session.active && session.process) {
      try {
        const shutdownCmd: DaemonCommand = {
          id: "shutdown-" + sessionId,
          type: "shutdown",
        };
        await this.sendCommandRaw(session, shutdownCmd, 5000);
      } catch {
        // Ignore shutdown errors
      }
    }

    this.cleanup(session);
    this.sessions.delete(sessionId);
  }

  private cleanup(session: TouchSession): void {
    session.active = false;
    if (session.process) {
      try {
        session.process.stdin.end();
      } catch {
        // ignore
      }
      try {
        session.process.kill("SIGTERM");
      } catch {
        // ignore
      }
      session.process = null;
    }
  }

  getSession(sessionId: string): TouchSession | undefined {
    return this.sessions.get(sessionId);
  }

  listSessions(): Array<{ id: string; host: string; active: boolean }> {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      host: `${s.config.user}@${s.config.host}:${s.config.port}`,
      active: s.active,
    }));
  }

  async disconnectAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    for (const id of ids) {
      await this.disconnect(id);
    }
  }
}
