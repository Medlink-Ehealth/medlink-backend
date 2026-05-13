import { authenticateEncryptedToken, Router, statusCodes } from "@medlink/common";
import { patientProfile } from "./profile.route.js";
import { patientRecords } from "./records.route.js";
import { patientDocuments } from "./documents.route.js";
import { patientProviders } from "./providers.route.js";
import { patientHistory } from "./history.route.js";

// API endpoints
const routerPrefix = "/v1/patients";
const router = Router({
	prefix: routerPrefix,
});

/* All endpoint in this service requires authentication/authorisation. Hence we enforce that here */
router.use(
	async (ctx, next) => {
		// confirm authentication
		if (ctx.isUnauthenticated()) await authenticateEncryptedToken(ctx);

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

router.use(patientProfile.routes());
router.use(patientHistory.routes());
router.use(patientDocuments.routes());
router.use(patientProviders.routes());
router.use(patientRecords.routes());

export { router as v1 };
