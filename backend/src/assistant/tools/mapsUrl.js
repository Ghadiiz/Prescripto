// Built server-side, never by the model: a URL the model composed could point
// anywhere. Shared by every tool that returns an address.
//
// Returns null when there is no address on file, so a caller can tell "no
// location known" from a link that silently points at nothing.
export const buildMapsUrl = (addressLine1, addressLine2) => {
  const address = [addressLine1, addressLine2].filter(Boolean).join(', ');
  if (!address) return null;

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
};
