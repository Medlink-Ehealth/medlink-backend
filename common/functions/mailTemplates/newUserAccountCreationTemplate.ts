import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { config } from "../../platform.config.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resolve = (p: string) => path.resolve(__dirname, p);
const root = process.cwd();

export const newUserAccountCreationTemplate = ({
	otp,
	verificationLink,
	greetings,
	name,
	header,
	body,
	footer,
}: {
	otp?: string;
	verificationLink?: string;
	greetings: string;
	name: string;
	header?: string;
	body: string;
	footer: string;
}) => {
	const verifier = verificationLink || otp;
	if (!verifier) throw new Error("Either 'otp' or 'verificationLink' must be provided.");

	const templateRoute = resolve(path.join(root, "site", "mailTemplates", "newUserAccountCreation.txt"));

	let readTemplate = fs.readFileSync(templateRoute, "utf-8");
	// let replace placeholders
	readTemplate = readTemplate.replace("$${header placeholder}$$", header || "One more step to go!");

	readTemplate = readTemplate.replace("$${salutation placeholder}$$", `Hello, ${name}!`); // placeholder for template name salutation

	readTemplate = readTemplate.replace("$${greetings placeholder}$$", greetings || "This is placeholder for template greetings");

	readTemplate = readTemplate.replace("$${body placeholder}$$", body || "This is placeholder for template body");

	readTemplate = readTemplate.replace("$${OTP code placeholder}$$", verifier);

	readTemplate = readTemplate.replace(
		"$${footer placeholder}$$",
		`${footer ? footer + "<br><br>" : ""}
                        Copyright &copy; ${new Date(Date.now()).getFullYear()} | ${config.projectName}`,
	);

	return readTemplate;
};
