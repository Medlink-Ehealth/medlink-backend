import { Router, statusCodes } from "@medlink/common";
import { accountManagementRoutes } from "./accounts/index.js";
import { platformSearchNLogs } from "./sitewideSearchNLogs/index.js";

const router = Router();

// Check privilege/status
router.use(async (ctx, next) => {
	if (!ctx.state.user.role || ctx.state.user.role < 1) {
		ctx.status = statusCodes.UNAUTHORIZED;
		ctx.message = "An active account is required to access platform-level managements";
		return;
	} else await next();
});

router.use(accountManagementRoutes.routes());
router.use(platformSearchNLogs.routes());

export { router as platformManagementRoutes };
