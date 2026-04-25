import { nonAuthAccountRelatedRoutes } from "./accountPublic/index.route.js";
import { authRouter } from "./auth/index.js";
import { default as dbFields } from "./dbFieldsOptions/index.js";
import { Router } from "@medlink/common";
import { otpEndpoints } from "./otp/index.routes.js";

// API endpoints
const routerPrefix = "/v1";

const router = Router({
	prefix: routerPrefix,
});

// misc
router.use(dbFields.routes());

// privileged account routes
router.use(authRouter.routes());
//account sign in routes.
router.use(nonAuthAccountRelatedRoutes.routes());
// OTP endpoints
router.use(otpEndpoints.routes());

export { router as v1 };
