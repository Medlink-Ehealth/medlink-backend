import { Router, statusCodes } from "@medlink/common";

const router = Router("client");

// Check client authorisation status
router.use(async (ctx, next) => {
	if (ctx.state.user.type !== "client") {
		ctx.status = statusCodes.UNAUTHORIZED;
		ctx.message = "Oops! User type not eligible/authorized to access client (user) endpoints";
		return;
	}
	await next();
});

export { router as clientRoutes };
