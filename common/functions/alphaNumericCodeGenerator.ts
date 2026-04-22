import crypto from "node:crypto";

//generator of unique OTP code for general usage
const alphaNumericCodeGenerator = ({
	length,
	base,
	type,
}: {
	length?: number;
	base?: number;
	type?: "alphanumeric" | "numbers" | "alphabets";
}) => {
	let mathBase = base ? base : 36;
	let lengthOfCode = length ? length : 5;
	if (typeof mathBase === "string") mathBase = Number(mathBase);
	if (typeof lengthOfCode === "string") lengthOfCode = Number(lengthOfCode);

	if (!Number.isInteger(mathBase)) mathBase = 36;
	if (!Number.isInteger(lengthOfCode)) lengthOfCode = 5;

	let code = type === "numbers" ? crypto.randomBytes(mathBase).readUIntBE(0, 6) : crypto.randomBytes(mathBase).toString("hex").substring(1);
	code = code.toString().substring(0, lengthOfCode); // shrink to length of code required
	return type === "numbers" ? code : code.toUpperCase();
};

export { alphaNumericCodeGenerator };
