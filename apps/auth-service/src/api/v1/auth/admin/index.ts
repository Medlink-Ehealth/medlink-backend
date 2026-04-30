import { Router, statusCodes } from "@medlink/common";
import { managerialRoutes } from "./managerialRoutes/index.js";
import { platformManagementRoutes } from "./platformManagement/index.js";

const router = Router("admin");

/*
admin roles = [
  { level: -2, label: "Blocked" }, // users delibrately blocked
  { level: -1, label: "Unverified" }, // unverified user
  { level: 0, label: "Inactive" }, // dormant user
  { level: 1, label: "Customer Support" }, // Average regular staff account user
	{ level: 2, label: "Operations Staff" }, // A senior management user
	{ level: 3, label: "Admin (Top-Level Management)" }, // Most senior Admin user
  { level: 999, label: "Site Administrator" }, // Website maintenance
]; 
*/

// Check admin authorisation status
router.use(async (ctx, next) => {
	if (ctx.state.user.type !== "admin") {
		ctx.status = statusCodes.UNAUTHORIZED;
		ctx.message = "Oops! User type not eligible/authorized to access administration resources.";
		return;
	}
	await next();
});

router.use(managerialRoutes.routes());
router.use(platformManagementRoutes.routes());

export { router as adminRoutes };
