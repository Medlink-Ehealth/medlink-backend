import { expect, test } from "vitest";
import "dotenv/config";
import { storageConnector } from "../../../../common/src/functions/storageManager.js";
import path from "node:path";
import url from "node:url";
import { writeFileSync } from "node:fs";
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const resolve = (p: string) => path.resolve(__dirname, p);
const envs = process.env;

test("Test upload connectivity", async () => {
	// check connectivity
	expect(
		await (async () => {
			const storage = new storageConnector();
			return await storage.testConnectivity();
		})(),
	).toBeTruthy();
});

test("Upload sample document to check if storage is working, whether azure blob storage or local", async () => {
	// confirm upload succeeds
	expect(
		await (async () => {
			// lets create a dummy file for testing upload
			const dummyTestFile = resolve(path.join(".", "testStorageUpload.txt"));
			writeFileSync(dummyTestFile, "Hello World!!");
			console.log("dummyTestFile::", dummyTestFile);

			const storage = new storageConnector();
			const upload = await storage.uploadMedia({ files: dummyTestFile, relativeContainer: "temp", mediaPath: "private" });

			console.log("upload::", JSON.stringify(upload, null, 2));
			return upload.success ? upload : "Unsucccessful upload";
		})(),
	).toBeTypeOf("object");
});
