import { logger } from "./utils/logger.js";
import { init, InMemoryCache } from "./server.js";
import { config } from "./platform.config.js";
export * from "./utils/index.js";
export * from "./models/index.js";
export * from "./middlewares/index.js";
export * from "./functions/index.js";
export * from "./constants/index.js";
export * from "./config/index.js";
export * from "./@types/index.js";

export { logger };
export { init as server };
export { InMemoryCache };
export { config as PlatformConfig };

/**
 * Custom caching mechanism using Map()
 */
// export const customCache = {
// 	data: new Map(),
// 	timers: new Map(),
// 	/**
// 	 * @param {string} key
// 	 * @param {(string | undefined)} value
// 	 * @param {?("EX" | number)} [expire]
// 	 * @param {number} [ttl=24 * 60 * 60] In string
// 	 */
// 	set: (
// 		key: string,
// 		value: string | undefined,
// 		expire?: "EX" | number, // dummy placeholder to match redis style
// 		ttl: number = 24 * 60 * 60, // ttl is in seconds -> defaults to 1 day
// 	) => {
// 		if (customCache.timers.has(key)) {
// 			clearTimeout(customCache.timers.get(key));
// 		}
// 		// call delete if a ky is set as undefined
// 		if (value !== undefined) {
// 			const actualTTL = typeof expire === "string" || (expire && ttl) ? ttl : expire || ttl;
// 			customCache.timers.set(
// 				key,
// 				setTimeout(() => customCache.delete(key), actualTTL * 1000),
// 			);
// 			customCache.data.set(key, value);
// 		} else {
// 			customCache.timers.delete(key);
// 			customCache.data.delete(key);
// 		}
// 	},
// 	get: (key: string) => customCache.data.get(key) as string,
// 	has: (key: string) => customCache.data.has(key),
// 	del: (key: string) => customCache.delete(key),
// 	delete: (key: string) => {
// 		if (customCache.timers.has(key)) {
// 			clearTimeout(customCache.timers.get(key));
// 		}
// 		customCache.timers.delete(key);
// 		return customCache.data.delete(key);
// 	},
// 	expire: (key: string, ttl: number) => {
// 		if (customCache.timers.has(key)) {
// 			clearTimeout(customCache.timers.get(key));
// 		}
// 		customCache.timers.set(
// 			key,
// 			setTimeout(() => customCache.delete(key), ttl * 1000),
// 		);
// 	},
// 	clear: () => {
// 		customCache.data.clear();
// 		for (const v of customCache.timers.values()) {
// 			clearTimeout(v);
// 		}
// 		customCache.timers.clear();
// 	},
// };
