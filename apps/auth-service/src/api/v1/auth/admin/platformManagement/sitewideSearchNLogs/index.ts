import { Router } from "@medlink/common";
import { platformWideSearchRoutes } from "./search.routes.js";

const router = Router();

// Check privilege/status
router.use(async (ctx, next) => {
	await next();
});

router.use(platformWideSearchRoutes.routes());

export { router as platformSearchNLogs };
