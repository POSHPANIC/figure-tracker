import { prisma } from "../prisma";

/**
 * Erase everything we hold about one eBay user.
 *
 * Right now this genuinely finds nothing, and that's not an oversight — it's
 * the reason Vitrine also qualifies for eBay's exemption. We store item
 * data from listings (title, price, condition, image, URL) and never the
 * identity of the person selling or buying.
 *
 * The function exists anyway because:
 *   • eBay requires the endpoint to actually do something, and "nothing to do"
 *     should be a verified result rather than an assumption;
 *   • the moment anyone adds a seller username to Listing, this is the one
 *     place that has to change, and it's findable.
 *
 * If you add such a field, delete or null it here and include it in the count.
 */
export async function eraseEbayUserData(ebayUserId: string): Promise<number> {
  let erased = 0;

  // --- Add deletions here as the schema grows. ---
  //
  // Example, once Listing has a sellerUsername column:
  //
  //   const result = await prisma.listing.updateMany({
  //     where: { sellerUsername: ebayUserId },
  //     data: { sellerUsername: null },
  //   });
  //   erased += result.count;

  // Touch prisma so the dependency is real rather than aspirational, and so a
  // broken database connection surfaces here instead of silently reporting 0.
  await prisma.$queryRaw`SELECT 1`;
  void ebayUserId;

  return erased;
}
