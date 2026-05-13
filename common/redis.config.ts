import "dotenv/config";
import { logger } from "./src/utils/logger.js";
const envs = process.env;

export const redisConfig = (): { port: number; host: string } | null => {
	if (envs.REDIS_CLIENT)
		try {
			const redisInfo = envs.REDIS_CLIENT && (JSON.parse(envs.REDIS_CLIENT) as [string, number]);
			if (redisInfo && Array.isArray(redisInfo)) {
				return {
					port: redisInfo[1] && typeof redisInfo[1] === "number" ? redisInfo[1] : 6379, // Redis port
					host: redisInfo[0] && typeof redisInfo[0] === "string" ? redisInfo[0] : "127.0.0.1", // Redis host
				};
			} else return null;
		} catch (err) {
			logger.error("Unable to parse redis configuration in env: ", err);
		}
	return null;
};
