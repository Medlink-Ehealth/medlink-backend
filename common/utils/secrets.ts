import "dotenv/config";
import { logger } from "./logger.js";
import process from "node:process";
// import config from "../../app.config.js";

const { DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME, DB_SCHEMA, DIALECT, DB_SSL, DB_STORAGE } = process.env;
// const { apiEndpoint } = config;

const requiredCredentials =
	DIALECT && (DIALECT.toLowerCase() === "sqlite" || DIALECT.toLowerCase() === "sqlite3")
		? [] //["DIALECT", "DB_STORAGE"]
		: [
				"DB_HOST",
				"DB_PORT",
				"DB_USER",
				// "DB_PASS", password can be optional on a local server
				// "DB_SCHEMA",
				"DIALECT",
				"DB_NAME",
				//"BASE_URL",
			];
// const requiredConfig: string[] = ["API_ENDPOINT"];
//Reserve credential output error here
const ErrorOutput: { [key: string]: string } = {};

if (requiredCredentials.length)
	for (const credential of requiredCredentials) {
		if (process.env[credential] === undefined) {
			const errorIndex = Object.keys(ErrorOutput).length;
			ErrorOutput["error" + errorIndex] = `Missing required crendential: ${credential}`;
		}
	}

if (Object.keys(ErrorOutput).length) logger.error(JSON.stringify(ErrorOutput, null, 2));
// const API_ENDPOINT = apiEndpoint;
export { DB_HOST, DB_STORAGE, DB_PORT, DB_USER, DB_PASS, DB_NAME, DB_SCHEMA, DIALECT, /* API_ENDPOINT, */ DB_SSL };
