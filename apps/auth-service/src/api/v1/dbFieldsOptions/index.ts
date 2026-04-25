import { authenticateEncryptedToken, Router, statusCodes } from "@medlink/common";
import { default as Roles } from "./Roles.route.js";

const router = Router({
	prefix: "/auth",
});

// Check authorisation status
router.use(
	async (ctx, next) => {
		//Check if authenticated by cookie session, else do JWT auth
		//Cookie based auth is saved in cookie and managed by passportJS
		if (ctx.isUnauthenticated()) authenticateEncryptedToken(ctx);

		await next();
	},
	async (ctx, next) => {
		if (ctx.isUnauthenticated()) {
			ctx.status = statusCodes.UNAUTHORIZED;
			return (ctx.body = { message: "Unauthorised. User not Signed In" });
		}
		await next();
	},
);

router.use(Roles.routes());

export default router;
