/** Deliberately bounded operational events: never log URLs, cookies, keys, or secrets. */
export function event(
  name: string,
  fields: Record<string, string | number | boolean | null>,
): void {
  console.log(
    JSON.stringify({
      component: "magento2-cloudflare-apo",
      event: name,
      ...fields,
    }),
  );
}
