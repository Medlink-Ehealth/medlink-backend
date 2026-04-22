//default files initializer on new installations
import path from "node:path";
import fs from "node:fs";
import process from "node:process";
import "dotenv/config";

const __dirname = path.dirname("./");
const privateDir =
  process.env["privatePath"] &&
  path.join(__dirname, process.env["privatePath"]);
const globalDir =
  process.env["globalPath"] && path.join(__dirname, process.env["globalPath"]);
const tempDir =
  process.env["tempFolder"] && path.join(__dirname, process.env["tempFolder"]);
const privateTempDir =
  process.env["tempPrivateFolder"] &&
  path.join(__dirname, process.env["tempPrivateFolder"]);
const settingsDir =
  process.env["settings"] && path.join(__dirname, process.env["settings"]);

const globalImageDir = globalDir + "/images";
const globalVideoDir = globalDir + "/videos";
const privateImageDir = privateDir + "/images";
const privateVideoDir = privateDir + "/videos";
const avatarsPrivateDir = privateDir + "/images/avatars";
const avatarsGlobalDir = globalDir + "/images/avatars";
const optionalSettingsDir = settingsDir;

const filesFolderInit = () => {
  if (tempDir && !fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  if (!fs.existsSync(globalImageDir)) {
    fs.mkdirSync(globalImageDir, { recursive: true });
  }
  if (!fs.existsSync(globalVideoDir)) {
    fs.mkdirSync(globalVideoDir, { recursive: true });
  }
  if (!fs.existsSync(privateImageDir)) {
    fs.mkdirSync(privateImageDir, { recursive: true });
  }
  if (!fs.existsSync(privateVideoDir)) {
    fs.mkdirSync(privateVideoDir, { recursive: true });
  }
  if (!fs.existsSync(avatarsPrivateDir)) {
    fs.mkdirSync(avatarsPrivateDir, { recursive: true });
  }
  if (!fs.existsSync(avatarsGlobalDir)) {
    fs.mkdirSync(avatarsGlobalDir, { recursive: true });
  }
  if (privateTempDir && !fs.existsSync(privateTempDir)) {
    fs.mkdirSync(privateTempDir, { recursive: true });
  }
  if (optionalSettingsDir && !fs.existsSync(optionalSettingsDir)) {
    fs.mkdirSync(optionalSettingsDir, { recursive: true });
    //create a site.config.json file
    if (fs.existsSync(optionalSettingsDir)) {
      const settingFile = "/site.config.json";
      const data = "{}";
      fs.writeFileSync(optionalSettingsDir + settingFile, data);
    }
  }
};

filesFolderInit();
