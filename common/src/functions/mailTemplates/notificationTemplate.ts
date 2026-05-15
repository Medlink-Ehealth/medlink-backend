
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { config } from "../../platform.config.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resolve = (p: string) => path.resolve(__dirname, p);
const root = process.cwd();

export const notificationTemplate = ({ header, body, footer }: { header: string; body: string; footer?: string }) => {

	const templateRoute = resolve(path.join(root, "site", "mailTemplates", "notifications.txt"));

	let readTemplate = fs.readFileSync(templateRoute, "utf-8");
	// let replace placeholders
	readTemplate = readTemplate.replace("$${header placeholder}$$", header || "This is placeholder for template Header");
	readTemplate = readTemplate.replace("$${body placeholder}$$", body || "This is placeholder for template body");
	readTemplate = readTemplate.replace(
		"$${footer placeholder}$$",
		`${footer ? footer + "<br><br>" : ""}
                        Copyright &copy; ${new Date(Date.now()).getFullYear()} | ${config.projectName}`
	);

	return readTemplate;
};
