import { Router, authenticateEncryptedToken, statusCodes } from "@medlink/common";
import { adminRoutes } from "./admin/index.js";
import { clientRoutes } from "./client/index.js";
import { usersCommonEndpoints } from "./common/index.js";

const router = Router("auth");

// Check authorisation status
router.use(
	async (ctx, next) => {
		// confirm authentication
		if (ctx.isUnauthenticated()) await authenticateEncryptedToken(ctx);

		// lets allow refreshtoken to optionally pass validation if it exists and authenticateEncryptedToken fails
		/* if (ctx.isUnauthenticated() && (ctx.path === "/api/v1/auth" || ctx.path === "/api/v1/auth/request_token")) {
			await refreshAccessToken()(ctx);
			await authenticateEncryptedToken(ctx, next);
		} else  */
		await next();
	},
	async (ctx, next) => {
		if (ctx.isUnauthenticated()) {
			ctx.status = statusCodes.UNAUTHORIZED;
			ctx.message = "Unauthorised. Account not Signed In";
			return;
		} else await next();
	},
);

/* 
	Get signed in User data
	Link also allows to check for refresh token value in ctx.body and not ovewrite it. This is processed in the use() command on index entry
*/
router.get("/", (ctx) => {
	if (ctx.isAuthenticated()) {
		if (ctx.body) ctx.body = { ...ctx.body, status: statusCodes.OK, account: ctx.state.user };
		else ctx.body = { status: statusCodes.OK, account: ctx.state.user };
		ctx.status = statusCodes.OK;
		return ctx.body;
	}
	ctx.status = statusCodes.UNAUTHORIZED;
	ctx.message = "Account not signed in.";
	return;
});

/* 
	Direct endpoint to return request token.
	Currently not in use as refresh token storage mechanism not in place yet
*/
router.get("/request_token", (ctx) => {
	if (ctx.isAuthenticated()) {
		ctx.status = statusCodes.OK;
		return ctx.body; // refresh token and access token should already exists on ctx.body here
	}
	ctx.status = statusCodes.UNAUTHORIZED;
	ctx.message = "Account need to be verifiable to request token.";
	return;
});

// users common endpoints
router.use(usersCommonEndpoints.routes());

// Admin specific account routes
router.use(adminRoutes.routes());
// Client specific account routes
router.use(clientRoutes.routes());

export { router as authRouter };
