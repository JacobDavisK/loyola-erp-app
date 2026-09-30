/** Typed application errors. Route handlers and actions map them to safe user-facing responses. */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "VALIDATION" | "RATE_LIMITED" | "WORKFLOW" | "AI_NOT_CONFIGURED" | "AI_UPSTREAM" | "AI_FORMAT",
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthenticated = () => new AppError("Please sign in to continue.", "UNAUTHENTICATED", 401);
export const forbidden = (msg = "You don't have permission to perform this action.") => new AppError(msg, "FORBIDDEN", 403);
export const notFound = (what = "Record") => new AppError(`${what} not found.`, "NOT_FOUND", 404);
export const conflict = (msg: string, details?: unknown) => new AppError(msg, "CONFLICT", 409, details);
export const invalid = (msg: string, details?: unknown) => new AppError(msg, "VALIDATION", 422, details);
export const rateLimited = (msg = "Too many attempts. Please wait and try again.") => new AppError(msg, "RATE_LIMITED", 429);
export const workflowError = (msg: string) => new AppError(msg, "WORKFLOW", 409);

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
