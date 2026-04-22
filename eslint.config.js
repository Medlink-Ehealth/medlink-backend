import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
	{
		files: ["**/*.{js,mjs,cjs,ts,jsx,tsx}"],
		rules: {
			"prefer-const": "warn",
			"no-constant-binary-expression": "error",
		},
		settings: {
			react: {
				version: "detect",
			},
		},
		languageOptions: {
			parserOptions: {
				ecmaFeatures: {
					jsx: true,
				},
			},
		},
	},
	pluginJs.configs.recommended,
	...tseslint.configs.recommended,
	{
		rules: {
			// Base Warnings
			"no-console": "warn",
			// TypeScript
			"@typescript-eslint/no-unused-vars": "error",
		},
	},
];
