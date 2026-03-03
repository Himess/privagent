// Copyright (c) 2026 PrivAgent Contributors — BUSL-1.1

/**
 * [M5] Lightweight structured logger for PrivAgent SDK.
 * No external dependencies — formatted console output.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(
  level: LogLevel,
  component: string,
  message: string,
  data?: Record<string, unknown>
): string {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}] [${component}]`;
  const dataStr = data ? ` ${JSON.stringify(data)}` : "";
  return `${prefix} ${message}${dataStr}`;
}

export interface Logger {
  debug: (msg: string, data?: Record<string, unknown>) => void;
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
}

export function createLogger(component: string): Logger {
  return {
    debug: (msg: string, data?: Record<string, unknown>) => {
      if (shouldLog("debug"))
        console.debug(formatMessage("debug", component, msg, data));
    },
    info: (msg: string, data?: Record<string, unknown>) => {
      if (shouldLog("info"))
        console.info(formatMessage("info", component, msg, data));
    },
    warn: (msg: string, data?: Record<string, unknown>) => {
      if (shouldLog("warn"))
        console.warn(formatMessage("warn", component, msg, data));
    },
    error: (msg: string, data?: Record<string, unknown>) => {
      if (shouldLog("error"))
        console.error(formatMessage("error", component, msg, data));
    },
  };
}
