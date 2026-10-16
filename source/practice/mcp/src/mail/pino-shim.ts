// Stands in for `pino` in the bundle (scripts/bundle.mjs aliases it here).
// imapflow builds a pino logger when it is imported, and pino's default
// destination is stdout, which carries this server's MCP JSON-RPC stream. Every
// ImapFlow is built with `logger: false` as well; this shim makes sure nothing
// from imapflow's logger can reach stdout and keeps pino's transports out of
// the bundle.

type LogFn = (...args: unknown[]) => void;

interface SilentLogger {
  level: string;
  trace: LogFn;
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  fatal: LogFn;
  child: () => SilentLogger;
}

const noop: LogFn = () => {};

const logger: SilentLogger = {
  level: "silent",
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => logger,
};

export function pino(): SilentLogger {
  return logger;
}

export default pino;
