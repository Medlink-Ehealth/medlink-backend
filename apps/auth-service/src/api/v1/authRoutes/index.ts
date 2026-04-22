import { default as user } from "./user.account.routes.js";
import { default as accounts } from "./accounts.routes.js";
import { default as notifications } from "./notifications.route.js";
import { authenticateEncryptedToken } from "../../../utils/index.js";
import { Router } from "../../../middlewares/router.js";
import { statusCodes } from "../../../constants/index.js";
import { UserAccessTimestamp } from "../../../../../../common/models/UserAccessTimestamp.model.js";

/* 
	While refresh token is integrated in core, it is currently not in use in core API routes as decision had not been made on the storage mechanism to used.
	In integrated Server APP API, external or redis storage use should preferrable be prioritised
*/
const router = Router({
	prefix: "/auth",
});

// Enforce that '/auth' route is only from an authorised frontend or Request App, which should be set in the header of the REQUEST as: "x-request-referral"
router.use(
	async (ctx, next) => {
		if (ctx.isUnauthenticated()) await authenticateEncryptedToken(ctx);
		/* 
			Check authorisation status, with process to check if refresh token exists when on '/auth' to regenerate a valid access token from an active refreshToken value.
			lets allow refreshtoken to optionally pass validation if it exists and authenticateEncryptedToken fails
		*/
		/* if (ctx.isUnauthenticated() && ctx.path === "/auth") {
			await refreshAccessToken(// { accessTokenLifetime: "7d" }

			)(ctx);
			await authenticateEncryptedToken(ctx, next);
		} else  */
		await next();
	},
	async (ctx, next) => {
		if (ctx.isUnauthenticated()) {
			ctx.status = statusCodes.UNAUTHORIZED;
			ctx.message = "Unauthorised. User not Signed In";
			return;
		}
		//check to be sure only an active account can use create (post) or update (patch) entities/contents
		if ((ctx.method.toLowerCase() === "post" || ctx.method.toLowerCase() === "patch") && !ctx.state.user.state) {
			ctx.status = statusCodes.UNAUTHORIZED;
			ctx.message =
				"Currently unable to complete your request because your account is not active. Please contact an admin if this is an error.";
			return;
		}
		//update user access time if more than 2 hours
		const twoHourAgo = Date.now() - 60 * 60 * 1000 * 2;
		const lastLoggedAccess = ctx.state.user.access.current ? new Date(ctx.state.user.access.current).getTime() : 0;
		if (lastLoggedAccess < twoHourAgo) {
			const currentTime = new Date(Date.now()).toISOString();
			ctx.state.user.access.current = currentTime;
			//update user timestamp model
			if (ctx.sequelizeInstance)
				UserAccessTimestamp(ctx.sequelizeInstance).update(
					{
						current: currentTime,
					},
					{
						where: {
							account_id: ctx.state.user.uuid,
						},
					},
				);
		}
		await next();
	},
);

/* 
	Get signed in User data
	Link also allows to check for refresh token value in ctx.body and not ovewrite it. This is processed in the use() command on index entry
*/
router.get("/", (ctx) => {
	if (ctx.isAuthenticated()) {
		if (ctx.body) ctx.body = { ...(ctx.body as object), status: statusCodes.OK, account: ctx.state.user };
		else ctx.body = { status: statusCodes.OK, account: ctx.state.user };
		ctx.status = statusCodes.OK;
		return ctx.body;
	}
	ctx.status = statusCodes.UNAUTHORIZED;
	ctx.message = "Account not signed in.";
	return;
});

/* 
	Direct endpoint to return request token
*/
/* router.get("/request_token", (ctx) => {
	if (ctx.isAuthenticated()) {
		ctx.status = statusCodes.OK;
		return ctx.body; // refresh token and access token should already exists on ctx.body here
	}
	ctx.status = statusCodes.UNAUTHORIZED;
	ctx.message = "Account need to be verifiable to request token.";
	return;
}); */

// currently signed in user account
router.use(user.routes());
router.use(notifications.routes());
// all accounts routes condensed in one router @ /account
router.use(accounts.routes());

export default router;
