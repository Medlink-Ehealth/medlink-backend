import { Router, statusCodes } from "@medlink/common";
import { siteSettings } from "./site.settings.route/index.js";

/* Privileged Platform management endpoints */
const router = Router("management");

// Check authorisation status
router.use(async (ctx, next) => {
	if (ctx.state.user.role < 2) {
		ctx.status = statusCodes.UNAUTHORIZED;
		ctx.message = "Oops! Management privilege is needed here";
		return;
	}
	await next();
});

// site.settings.route
router.use(siteSettings.routes());

export { router as managerialRoutes };
