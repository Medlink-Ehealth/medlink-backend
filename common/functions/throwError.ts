import { appInstance } from "../server.js";

const throwError = (
	props: number | { err: Error | string; status: number; properties?: object },
	err?: Error | string,
	properties?: object,
) => {
	const status = typeof props === "number" ? props : props.status;
	const error = typeof props === "number" ? err : props.err;
	const propObject = typeof props === "number" ? properties : props.properties;
	//console.log("appContext", appInstance.currentContext);
	if (appInstance.currentContext)
		return appInstance.currentContext.throw(
			status,
			typeof error === "string" ? new Error(error) : err ? err : new Error(),
			propObject || { expose: false },
		);
	else throw typeof error === "string" ? new Error(error) : err ? err : new Error();
};

export { throwError };
/* export type { ThrowError };
interface ThrowError {
	err: Error | string;
	status: number;
}
 */
