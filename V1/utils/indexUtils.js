/** Maps index names to canonical base (e.g. farcaster-items-v2 → farcaster-items). Used for feature/score keys. */
export function findIndex(index) {
  const indexOptions = ['farcaster-items', 'zora-coins', 'polymarket-items', 'polymarket-wallets', 'kalshi-items'];
  for (const option of indexOptions) {
    if (index.startsWith(option)) return option;
  }
  return null;
}
