import fs from "node:fs";
import { logger } from "../utils/logger.js";
import { DB_HOST, DB_STORAGE, DB_PORT, DB_USER, DB_PASS, DB_NAME, DB_SCHEMA, DIALECT, DB_SSL } from "../utils/secrets.js";
import { Dialect, Sequelize } from "sequelize";
import { config } from "../platform.config.js";

let requireDB = true;
/**
 * - We are also introducing dual/multitenancy database mode such that it is possible to test APIs built similar to greybox in a mock mode without direct impact on a live database data.
 * - We are also keeping SQlite in play for testing purpose to avoid strict reliance on PostgreSQL
 */
const sequelizex: { [env: string]: Sequelize } = {}; //multitenancy DB

const profile = {
	host: DB_HOST,
	storage: DB_STORAGE,
	port: DB_PORT,
	user: DB_USER,
	password: DB_PASS,
	database: DB_NAME,
	schema: DB_SCHEMA,
	dialect: DIALECT?.toLowerCase(),
	ssl: DB_SSL,
};

if (
	requireDB &&
	!profile.dialect?.includes("sqlite") &&
	(!profile.database ||
		!profile.user ||
		//!profile.password || password is optional on a local server
		!profile.host ||
		!profile.dialect)
	// !profile.schema
) {
	logger.error(
		`Database configurations are: database=
			${profile.database || "undefined"}, user=${profile.user || "undefined"}, password=${profile.password ? "Redacted" : "undefined"}, host=${profile.host || "undefined"}, dialect=${profile.dialect || "undefined"}, schema=${profile.schema || "undefined"}`,
	);
	// if ((profile.database||profile.dialect) &&(!profile.user||!profile.host||!profile.schema))
	throw new Error(
		`Incomplete database configurations: database=
			${profile.database || "undefined"}, user=${profile.user || "undefined"}, password=${profile.password ? "Redacted" : "undefined"}, host=${profile.host || "undefined"}, dialect=${profile.dialect || "undefined"}, schema=${profile.schema || "undefined"}`,
	);
} else if (requireDB) {
	/*  * 	- Here we check for db name, which are references to the main DB_NAME, using the api env mode as suffix to main. EG "_test" as suffix to DB_NAME
	 */
	const apiModes = config.apiMultiTenancyMode;
	const dbENV = !apiModes
		? ["live"]
		: typeof apiModes === "string"
			? [apiModes]
			: typeof apiModes === "boolean"
				? ["live", "test"]
				: apiModes;

	// sqlite has a little initilization difference
	const initSqlite = profile.dialect === "sqlite" || profile.dialect === "sqlite3" ? profile.storage || ":memory:" : null;

	// init dual DB mode
	for (const env of dbENV) {
		sequelizex[env] = initSqlite
			? new Sequelize({
					dialect: "sqlite",
					storage: initSqlite !== ":memory:" ? (env === "live" ? initSqlite : initSqlite + "_" + env) : initSqlite, // use Memory when storage location is not defined
				})
			: new Sequelize(
					env === "live" ? profile.database! : profile.database + "_" + env, // any other env auto-carries its suffix
					profile.user!,
					profile.password,
					{
						host: profile.host,
						dialect: profile.dialect as Dialect,
						schema: profile.schema,
						dialectOptions: {
							ssl: profile.ssl
								? profile.ssl === "true" || profile.ssl === "t"
									? true
									: profile.ssl === "false" || profile.ssl === "f"
										? false
										: {
												rejectUnauthorized: false,
												ca: fs.readFileSync(profile.ssl).toString(),
												/* key: readFileSync("/path/to/client-key/postgresql.key").toString(),
							cert: readFileSync("/path/to/client-certificates/postgresql.crt").toString(), */
											}
								: false,
						},
					},
				);
	}
	// when using sqlite as in memory, announce this
	if (initSqlite === ":memory:") {
		logger.info("Database initialized with SQLite in Memory mode. Hence data state is not persistence between restarts!");
		console.log("Database initialized with SQLite in Memory mode. Hence data state is not persistence between restarts!");
	}
}
// console.log("profile", profile);
// console.log("sequelizex", sequelizex);

const checkDBconnections = async () => {
	const tenants = Object.keys(sequelizex);
	let successConnection = 0;
	if (tenants.length)
		for (const tenant of tenants) {
			try {
				await sequelizex[tenant].authenticate();
				successConnection++;
				console.log(
					`${tenant.substring(0, 1).toUpperCase() + tenant.substring(1).toLowerCase()} tenant database connection has been established successfully.`,
				);
				logger.info(
					`${tenant.substring(0, 1).toUpperCase() + tenant.substring(1).toLowerCase()} tenant database connection has been established successfully.`,
				);
			} catch (error) {
				console.error(`Unable to connect to tenant '${tenant}' database:`, error);
				logger.error(`Unable to connect to tenant '${tenant}' database:`, error);
			}
		}

	if (successConnection !== tenants.length) {
		logger.error("Runtime startup exception. All tenancy database were unable to start up successfully!!");
		throw "All tenancy database were unable to start up successfully!!";
	}
};
checkDBconnections();
//console.log(checkDBconnect());
export { sequelizex as sequelizeInstances };
