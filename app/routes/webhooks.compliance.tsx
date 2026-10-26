import type { ActionFunctionArgs } from "react-router";
import { authenticate, sessionStorage } from "../shopify.server";

// Mandatory privacy webhooks (customers/data_request, customers/redact,
// shop/redact). authenticate.webhook verifies the HMAC and rejects anything
// not signed by Shopify.
//
// What this app stores:
// - no customer records at all (engraving text and the preview image live on
//   the order / in the merchant's own Files, which the merchant controls);
// - only the shop's OAuth sessions, in MongoDB.
// So customer requests need no action here beyond acknowledging them, and
// shop/redact (sent 48h after uninstall) removes any session left behind.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  if (topic === "SHOP_REDACT") {
    const sessions = await sessionStorage.findSessionsByShop(shop);
    if (sessions.length > 0) {
      await sessionStorage.deleteSessions(sessions.map((s) => s.id));
    }
  }

  return new Response();
};
