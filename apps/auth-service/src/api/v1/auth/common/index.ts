import { Router, statusCodes } from "@medlink/common";
import { CurrentUserSignedInAccount } from "./user.account.routes.js";
import { notificaions } from "./notifications.route.js";
import { userSetting } from "./user.setting.routes.js";

const router = Router();
const userTypes = {
	client: "Client",
	admin: "Admin",
};
const userTypeArray = Object.keys(userTypes);

router.use(async (ctx, next) => {
	if (!userTypeArray.includes(ctx.state.user.type)) {
		ctx.status = statusCodes.UNAUTHORIZED;
		ctx.message = "Oops! User type not eligible/authorized to access this resource(s)";
		return;
	}
	await next();
});

router.use(CurrentUserSignedInAccount.routes());
router.use(notificaions.routes());
router.use(userSetting.routes());

export { router as usersCommonEndpoints };
