import { Context, Middleware } from "koa";
import { IncomingMessage, ServerResponse } from "http";

/* Logic here is imported from koa-connect library and improved */
type ExpressMiddlewareArguments = (req: IncomingMessage, res: ServerResponse, callback: (...args: unknown[]) => void) => void;

const noop = () => {};

/**
 * If the middleware function does not declare receiving the `next` callback
 * assume that it's synchronous and invoke `next` ourselves.
 */
function noCallbackHandler(ctx: Context, middleware: ExpressMiddlewareArguments, next: (err?: unknown) => Promise<void>): Promise<void> {
  middleware(ctx.req, ctx.res, noop);
  return next();
}

/**
 * The middleware function does include the `next` callback so only resolve
 * the Promise when it's called. If it's never called, the middleware stack
 * completion will stall.
 */
function withCallbackHandler(ctx: Context, middleware: ExpressMiddlewareArguments, next: (err?: unknown) => Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    middleware(ctx.req, ctx.res, (err?: unknown) => {
      if (err) reject(err);
      else resolve(next());
    });
  });
}

/**
 * Returns a Koa middleware function that varies its async logic based on if the
 * given middleware function declares at least 3 parameters, i.e. includes
 * the `next` callback function.
 */
function expressMiddleware(middleware: ExpressMiddlewareArguments): Middleware {
  const handler = middleware.length < 3 ? noCallbackHandler : withCallbackHandler;
  return function koaConnect(ctx: Context, next: () => Promise<void>) {
    return handler(ctx, middleware, next);
  };
}

export { expressMiddleware };
