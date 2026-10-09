import dotenv from "dotenv";
dotenv.config();

function normalizeEndpoint(raw: string) {
  const v = (raw || "").trim().replace(/\/+$/, "");
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  return `https://${v}`;
}

function hostOf(endpoint: string) {
  try {
    return new URL(endpoint).host;
  } catch {
    return "";
  }
}

const spacesEndpoint = normalizeEndpoint(process.env.DO_SPACES_ENDPOINT || "");
const spacesBucket = (process.env.DO_SPACES_BUCKET || "").trim();
// Support both DO_SPACES_CDN and DO_SPACES_BASE_URL as the public base URL
const spacesCdn = (
  process.env.DO_SPACES_CDN ||
  process.env.DO_SPACES_BASE_URL ||
  ""
).trim().replace(/\/+$/, "");

export const config = {
  port: Number(process.env.PORT || 5000),
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/employee_details",
  jwtSecret: process.env.JWT_SECRET || "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "8h",
  clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
  uploadDir: new URL("../uploads/", import.meta.url).pathname,
  spaces: {
    endpoint: spacesEndpoint,
    region: (process.env.DO_SPACES_REGION || "nyc3").trim() || "nyc3",
    bucket: spacesBucket,
    key: (process.env.DO_SPACES_KEY || "").trim(),
    secret: (process.env.DO_SPACES_SECRET || "").trim(),
    cdn: spacesCdn,
    prefix: (process.env.DO_SPACES_PREFIX || "employees").trim().replace(/^\/+|\/+$/g, "") || "employees",
    publicAcl: (process.env.DO_SPACES_PUBLIC || "true").toLowerCase() !== "false",
  },
};

export const spacesEnabled =
  !!config.spaces.bucket &&
  !!config.spaces.key &&
  !!config.spaces.secret &&
  !!config.spaces.endpoint;

export function publicSpacesUrl(key: string): string {
  const clean = key.replace(/^\/+/, "");
  if (config.spaces.cdn) {
    // DO_SPACES_BASE_URL=https://nyc3.digitaloceanspaces.com  ->  https://nyc3.digitaloceanspaces.com/<bucket>/<key>
    // DO_SPACES_CDN=https://<bucket>.nyc3.digitaloceanspaces.com (or CDN host) -> <cdn>/<key>
    if (config.spaces.cdn.includes(config.spaces.bucket)) return `${config.spaces.cdn}/${clean}`;
    if (/digitaloceanspaces\.com$/i.test(hostOf(config.spaces.cdn))) return `${config.spaces.cdn}/${config.spaces.bucket}/${clean}`;
    return `${config.spaces.cdn}/${clean}`;
  }
  const host = hostOf(config.spaces.endpoint);
  if (host && config.spaces.bucket) return `https://${config.spaces.bucket}.${host}/${clean}`;
  return `${config.spaces.endpoint}/${config.spaces.bucket}/${clean}`;
}

if (!config.jwtSecret || config.jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be set and at least 32 characters long.");
}

