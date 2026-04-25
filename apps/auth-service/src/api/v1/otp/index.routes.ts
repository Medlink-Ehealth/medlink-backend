import { Router } from "@medlink/common";
import { newUserVerifyRoute } from "./newUserVerify.routes.js";

const router = Router("/otp");

router.use(newUserVerifyRoute.routes());

export { router as otpEndpoints };
