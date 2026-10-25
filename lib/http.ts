import { getKV, StorageNotConfiguredError } from "./kv";
import { UserError } from "./repo";
import { isRecord } from "./validate";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function errorResponse(message: string, status = 400) {
  return json({ error: message }, status);
}

/** Reads a JSON object body, or throws a UserError with a readable message. */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new UserError("The request body isn't valid JSON.");
  }
  if (!isRecord(body)) throw new UserError("The request body must be a JSON object.");
  return body;
}

const WRITES_PER_MINUTE = 30;

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

// Fixed one-minute window per IP, counted in the store so it holds across serverless instances.
export async function rateLimit(req: Request) {
  const minute = Math.floor(Date.now() / 60_000);
  const count = await getKV().incrWithExpiry(`g:rl:${clientIp(req)}:${minute}`, 70);
  if (count > WRITES_PER_MINUTE) {
    throw new UserError("Too many changes in a minute. Wait a moment and try again.", 429);
  }
}

/** Wraps a write handler: rate limit first, then turn known errors into readable responses. */
export function write<A extends unknown[]>(handler: (req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A) => {
    try {
      await rateLimit(req);
      return await handler(req, ...rest);
    } catch (e) {
      return handleError(e);
    }
  };
}

export function read<A extends unknown[]>(handler: (req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A) => {
    try {
      return await handler(req, ...rest);
    } catch (e) {
      return handleError(e);
    }
  };
}

function handleError(e: unknown) {
  if (e instanceof UserError) return errorResponse(e.message, e.status);
  if (e instanceof StorageNotConfiguredError) return errorResponse(e.message, 503);
  console.error(e);
  return errorResponse("Something went wrong on the server. Try again.", 500);
}
