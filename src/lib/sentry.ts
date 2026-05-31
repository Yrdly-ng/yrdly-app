// Mock Sentry utility functions for error tracking and user context
// Replaced with console logging to facilitate removal of @sentry/nextjs

const mockLogger = {
  trace: (...args: any[]) => console.trace(...args),
  debug: (...args: any[]) => console.debug(...args),
  info: (...args: any[]) => console.info(...args),
  warn: (...args: any[]) => console.warn(...args),
  error: (...args: any[]) => console.error(...args),
  fatal: (...args: any[]) => console.error('FATAL', ...args),
  fmt: (template: TemplateStringsArray, ...values: any[]) => {
    return template.reduce((acc, str, i) => acc + str + (values[i] || ''), '');
  }
};

export const logger = mockLogger;

export const captureException = (error: any) => {
  console.error("Captured Exception:", error);
};

export const startSpan = <T>(context: any, callback: (span: any) => T): T => {
  // Mock span that just runs the callback and measures simple time if needed
  const span = { ...context };
  return callback(span);
};

export const setUserContext = (user: {
  id: string;
  email?: string;
  name?: string;
  avatar_url?: string;
}) => {
  // console.log("Set User Context:", user);
};

export const clearUserContext = () => {
  // console.log("Clear User Context");
};

export const trackUserAction = (action: string, data?: Record<string, any>) => {
  // console.log("User Action:", action, data);
};

export const trackApiError = (error: Error, context: {
  endpoint: string;
  method: string;
  userId?: string;
  requestData?: any;
}) => {
  console.error("API Error:", error, context);
};

export const trackComponentError = (error: Error, context: {
  component: string;
  userId?: string;
  props?: any;
}) => {
  console.error("Component Error:", error, context);
};

export const trackPerformance = (name: string, duration: number, context?: Record<string, any>) => {
  // console.log("Performance:", name, duration, context);
};

export const trackFeatureUsage = (feature: string, data?: Record<string, any>) => {
  // console.log("Feature Usage:", feature, data);
};

export const trackEvent = (eventName: string, data?: Record<string, any>) => {
  // console.log("Track Event:", eventName, data);
};

export const trackDatabaseError = (error: Error, context: {
  operation: string;
  table?: string;
  userId?: string;
  query?: string;
}) => {
  console.error("Database Error:", error, context);
};

export const trackAuthError = (error: Error, context: {
  action: string;
  userId?: string;
  provider?: string;
}) => {
  console.error("Auth Error:", error, context);
};

export const trackRealtimeError = (error: Error, context: {
  channel: string;
  event: string;
  userId?: string;
}) => {
  console.error("Realtime Error:", error, context);
};

export const createUISpan = <T>(name: string, op: string, callback: (span: any) => T): T => {
  return startSpan({ name, op }, callback);
};

export const createAPISpan = <T>(name: string, op: string, callback: (span: any) => T): T => {
  return startSpan({ name, op }, callback);
};

export const logTrace = (message: string, data?: Record<string, any>) => {
  mockLogger.trace(message, data);
};

export const logDebug = (message: string, data?: Record<string, any>) => {
  mockLogger.debug(message, data);
};

export const logInfo = (message: string, data?: Record<string, any>) => {
  mockLogger.info(message, data);
};

export const logWarn = (message: string, data?: Record<string, any>) => {
  mockLogger.warn(message, data);
};

export const logError = (message: string, data?: Record<string, any>) => {
  mockLogger.error(message, data);
};

export const logFatal = (message: string, data?: Record<string, any>) => {
  mockLogger.fatal(message, data);
};

export const logDebugFmt = (template: TemplateStringsArray, ...values: any[]) => {
  mockLogger.debug(mockLogger.fmt(template, ...values));
};

export const logInfoFmt = (template: TemplateStringsArray, ...values: any[]) => {
  mockLogger.info(mockLogger.fmt(template, ...values));
};

export const logWarnFmt = (template: TemplateStringsArray, ...values: any[]) => {
  mockLogger.warn(mockLogger.fmt(template, ...values));
};

export const logErrorFmt = (template: TemplateStringsArray, ...values: any[]) => {
  mockLogger.error(mockLogger.fmt(template, ...values));
};
