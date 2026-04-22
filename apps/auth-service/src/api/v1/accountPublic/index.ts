import { publicAdminRoutes } from "./publicAdmin.routes.js";
import { publicUsers } from "./publicUsers.routes.js";
import { Router } from "../../../_/index.js";

const router = Router();

router.use(publicUsers.routes());

// Admin exclusive access endpoints
router.use(publicAdminRoutes.routes());

export { router as nonAuthAccountRelatedRoutes };
