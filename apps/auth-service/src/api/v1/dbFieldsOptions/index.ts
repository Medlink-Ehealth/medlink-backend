import { UNAUTHORIZED } from "../../../constants/statusCodes.js";
import { Router } from "../../../middlewares/router.js";
import { authenticateEncryptedToken } from "../../../utils/index.js";
import { default as EntityStatuses } from "./EntityStatuses.route.js";
import { default as Roles } from "./Roles.route.js";

const router =  Router({
  prefix: "/auth",
});

// Check authorisation status
router.use(
  async (ctx, next) => {
    //Check if authenticated by cookie session, else do JWT auth
    //Cookie based auth is saved in cookie and managed by passportJS
    if (ctx.isUnauthenticated()) authenticateEncryptedToken(ctx);

    await next();
  },
  async (ctx, next) => {
    if (ctx.isUnauthenticated()) {
      ctx.status = UNAUTHORIZED;
      return (ctx.body = { message: "Unauthorised. User not Signed In" });
    }
    await next();
  }
);

router.use(EntityStatuses.routes());
router.use(Roles.routes());

export default router;
