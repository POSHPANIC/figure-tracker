/**
 * "eBay", set as plain text, for attributing where listing data came from.
 *
 * It used to be the four letters of their wordmark in their four brand colours
 * -- #E53238, #0064D2, #F5AF02, #86B817 -- bold and italic and tightly
 * tracked. That was a recreation of their logo, and the Partner Network is
 * explicit that it must not be: "Any eBay logo should appear on your site,
 * apps, and social networks exactly as you download it from our Creative
 * Gallery, with no changes." A hand-built copy is neither the downloaded file
 * nor unchanged, however carefully the colours were matched.
 *
 * Naming a company in running text is not using its logo, so this is the safe
 * form and needs no licence. It also keeps the one thing the coloured version
 * was for: the reader can see which marketplace a row came from.
 *
 * To use the real mark, download it from the Creative Gallery in the EPN
 * partner portal, commit the file, and render it here. Every usage across the
 * site follows from this one component -- which is why it is a component and
 * not inline markup. Do not hotlink it: their terms are strict about serving
 * their images from their servers, and a remote logo breaks every figure page
 * the moment the URL moves.
 */

export function EbayMark({ className = "" }: { className?: string }) {
  return (
    <span className={`select-none font-semibold leading-none ${className}`}>eBay</span>
  );
}
