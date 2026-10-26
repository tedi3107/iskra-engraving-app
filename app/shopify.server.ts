import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { MongoDBSessionStorage } from "@shopify/shopify-app-session-storage-mongodb";
import { MONGO_DB_NAME } from "./mongo.server";
import { ensureCartTransform } from "./cart-transform.server";

// MONGODB_URI holds the full connection string, including the real
// username/password (e.g. mongodb+srv://user:pass@iskra.xxxxx.mongodb.net/).
// It's set as an environment variable in the hosting provider's dashboard
// (Vercel -> Project -> Settings -> Environment Variables) - never committed
// to the repo or hardcoded here.
// Fail fast on missing configuration instead of starting an app that can
// only fail later with a confusing OAuth/HMAC error.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set.`);
  }
  return value;
}

const mongodbUrl = new URL(requireEnv("MONGODB_URI"));

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: requireEnv("SHOPIFY_API_SECRET"),
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: requireEnv("SHOPIFY_APP_URL"),
  authPathPrefix: "/auth",
  sessionStorage: new MongoDBSessionStorage(
    mongodbUrl,
    MONGO_DB_NAME,
  ),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    afterAuth: async ({ admin }) => {
      // Never let this block the merchant from getting into the app — the
      // Setup cart transform page can still activate it manually.
      try {
        await ensureCartTransform(admin);
      } catch (error) {
        console.error("Automatic cart transform activation failed", error);
      }
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
