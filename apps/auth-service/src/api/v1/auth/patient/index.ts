import { Router, statusCodes } from "@medlink/common";

const router = Router("patient");

// Check patient authorisation status
router.use(async (ctx, next) => {
	if (ctx.state.user.type !== "patient") {
		ctx.status = statusCodes.UNAUTHORIZED;
		ctx.message = "Oops! User type not eligible/authorized to access patient (user) endpoints";
		return;
	}
	await next();
});

export { router as patientRoutes };
