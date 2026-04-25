import { Router, statusCodes } from "@medlink/common";
import { siteConfig } from "./site.config.route.js";

const router = Router("settings");
/* 
	Currently and geerally not in use
*/
router.use(async (ctx, next) => {
	if (ctx.state.user.role < 3) {
		ctx.status = statusCodes.UNAUTHORIZED;
		ctx.message = "Unauthorised. A managerial level of 3 (Executive) or higher is required to perform site-based operations/configurations";
		return (ctx.body = {
			status: statusCodes.UNAUTHORIZED,
			statusText: "Unauthorised. A managerial level of 3 (Executive) or higher is required to perform site-based operations/configurations",
		});
	}
	await next();
});
// site configuration updates. CONFIGs are saved as JSON
router.use(siteConfig.routes());

export { router as siteSettings };
