import { Router, statusCodes } from "@medlink/common";
import { allPlatformUserAccounts } from "./accounts.routes.js";

const router = Router("accounts");

// Check privilege/status
router.use(async (ctx, next) => {
	if (!ctx.state.user.role || ctx.state.user.role < 1) {
		ctx.status = statusCodes.UNAUTHORIZED;
		ctx.message = "An active account is required to access user managements";
		return;
	} else await next();
});

router.use(allPlatformUserAccounts.routes());

export { router as accountManagementRoutes };
