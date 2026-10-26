import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Jewelry engraving</h1>
        <p className={styles.text}>
          Let customers personalize jewelry with a live engraving preview, right on your product page.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Live preview</strong>. Customers see their text engraved on
            the actual product photo — straight or around a ring — as they type.
          </li>
          <li>
            <strong>Your fonts, your layout</strong>. Upload two fonts and place
            the engraving zone per product in a visual editor.
          </li>
          <li>
            <strong>Through to checkout</strong>. The engraved preview follows
            the item into the cart, checkout and the order.
          </li>
        </ul>
      </div>
    </div>
  );
}
