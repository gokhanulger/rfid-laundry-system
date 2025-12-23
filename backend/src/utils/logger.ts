/**
 * Simple structured logging utility
 * Outputs JSON logs for production, readable logs for development
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

const isProduction = process.env.NODE_ENV === 'production';

function formatLog(level: LogLevel, message: string, context?: LogContext): string {
  const timestamp = new Date().toISOString();

  if (isProduction) {
    // JSON format for production (easier to parse by log aggregators)
    return JSON.stringify({
      timestamp,
      level,
      message,
      ...context,
    });
  }

  // Readable format for development
  const contextStr = context ? ` ${JSON.stringify(context)}` : '';
  return `[${timestamp}] ${level.toUpperCase()}: ${message}${contextStr}`;
}

export const logger = {
  debug(message: string, context?: LogContext) {
    if (!isProduction) {
      console.debug(formatLog('debug', message, context));
    }
  },

  info(message: string, context?: LogContext) {
    console.log(formatLog('info', message, context));
  },

  warn(message: string, context?: LogContext) {
    console.warn(formatLog('warn', message, context));
  },

  error(message: string, error?: Error | unknown, context?: LogContext) {
    const errorContext: LogContext = { ...context };

    if (error instanceof Error) {
      errorContext.errorMessage = error.message;
      errorContext.errorStack = isProduction ? undefined : error.stack;
    } else if (error) {
      errorContext.error = String(error);
    }

    console.error(formatLog('error', message, errorContext));
  },

  // Request logging helper
  request(method: string, path: string, statusCode: number, durationMs: number, context?: LogContext) {
    const level: LogLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    const message = `${method} ${path} ${statusCode} ${durationMs}ms`;

    if (isProduction) {
      console.log(formatLog(level, message, {
        method,
        path,
        statusCode,
        durationMs,
        ...context,
      }));
    } else {
      console.log(formatLog(level, message, context));
    }
  },
};

export default logger;
