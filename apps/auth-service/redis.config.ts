import "dotenv/config";
import { logger } from "@medlink/common";
const envs = process.env;

const forceRedisInit = envs.MEMORY_CACHE?.toLowerCase() === "redis" || envs.CONVERSATION_STORE?.toLowerCase() === "redis"; // where a engine/procss exists that relies on redis, force an initializing even if envs.REDIS_CLIENT is unset - using local connection if available

export const redisConfig = (): { port: number; host: string } | null => {
	if (envs.REDIS_CLIENT || forceRedisInit)
		try {
			const redisInfo = envs.REDIS_CLIENT && (JSON.parse(envs.REDIS_CLIENT) as [string, number]);
			if (redisInfo && Array.isArray(redisInfo)) {
				return {
					port: redisInfo[1] && typeof redisInfo[1] === "number" ? redisInfo[1] : 6379, // Redis port
					host: redisInfo[0] && typeof redisInfo[0] === "string" ? redisInfo[0] : "127.0.0.1", // Redis host
				};
			} else if (forceRedisInit)
				// use default
				return {
					port: 6379,
					host: "127.0.0.1",
				};
			else return null;
		} catch (err) {
			logger.error("Unable to parse redis configuration in env: ", err);
		}
	return null;
};
