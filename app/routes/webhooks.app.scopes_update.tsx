import type { ActionFunctionArgs } from "react-router";
import { authenticate, sessionStorage } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const current = payload.current as string[];
  if (session) {
    // Update the session in the same MongoDB-backed storage that
    // authenticate.* reads from. The previous Prisma update targeted a row that
    // doesn't exist there, threw, and made Shopify retry this webhook.
    session.scope = current.toString();
    await sessionStorage.storeSession(session);
  }
  return new Response();
};
