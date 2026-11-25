import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const localEnvPath = resolve(process.cwd(), ".env");
loadEnv({ path: existsSync(localEnvPath) ? localEnvPath : resolve(process.cwd(), "../../.env") });
