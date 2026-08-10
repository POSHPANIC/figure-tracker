"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  CURRENCY_COOKIE,
  CURRENCY_COOKIE_MAX_AGE,
  isSupportedCurrency,
} from "@/lib/currency";
import type { ActionResult } from "./collection";

/**
 * Display preferences.
 *
 * Stored in a cookie rather than the database so it works signed-out — most
 * visitors to a price reference site never create an account, and "show me
 * prices in yen" shouldn't require one.
 */
export async function setDisplayCurrency(currency: string): Promise<ActionResult> {
  if (!isSupportedCurrency(currency)) {
    return { ok: false, error: "That currency isn't supported." };
  }

  const store = await cookies();
  store.set(CURRENCY_COOKIE, currency, {
    maxAge: CURRENCY_COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
    // Not httpOnly: it's a display preference, not a credential, and there's no
    // harm in client code reading it.
    httpOnly: false,
  });

  // Prices appear on nearly every page, so refresh the whole tree.
  revalidatePath("/", "layout");
  return { ok: true };
}
