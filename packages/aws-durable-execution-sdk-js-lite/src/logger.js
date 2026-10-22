// Replayed code already logged in an earlier invocation. isSilent lets the caller
// suppress those duplicate lines.
export function createLogger(isSilent = () => false) {
  const forward =
    (level) =>
    (...args) => {
      // biome-ignore lint/suspicious/noConsole: deliberate -- console is the only log sink (AGENTS.md 2.10). Lambda sends it to CloudWatch.
      if (!isSilent()) console[level](...args);
    };
  return {
    debug: forward("debug"),
    info: forward("info"),
    warn: forward("warn"),
    error: forward("error"),
  };
}
