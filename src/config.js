// Every on-chain name the hub depends on lives here, so a new farm, blend or
// pack only needs an edit to this file.

export const APP_NAME = 'SquishHub'

// WAX mainnet. The chain ID must be exact or every wallet refuses to sign.
export const WAX_CHAIN_ID =
  '1064487b3cd1a897ce03ae5b6a865651747e2e152090f99c1d19d44e01aea5a4'

// Public WAX API nodes, tried in order until one answers.
export const WAX_RPC_ENDPOINTS = [
  'https://wax.greymass.com',
  'https://wax.eosphere.io',
  'https://api.wax.alohaeos.com',
  'https://wax.eu.eosamsterdam.net',
]

// AtomicAssets indexers, used to find which NFTs a wallet holds.
export const ATOMIC_API_ENDPOINTS = [
  'https://wax.api.atomicassets.io',
  'https://aa-wax-public1.neftyblocks.com',
]

export const EXPLORER_TX_URL = 'https://waxblock.io/transaction/'

export const COLLECTION = 'ssquisheyezz'

// $SQUISH token
export const SQUISH_TOKEN = { contract: 'ribbitartwrk', symbol: 'SQUISH' }

// The SquishEyez WaxDAO NFT farms. Their rules, rates and status are read
// live from the chain.
//   v1 = waxdaofarmer (NFTs held by the contract while staked)
//   v2 = farms.waxdao (NFTs stay in your wallet)
// Farms are found on chain by the account that runs them (also the $SQUISH
// contract); this list gives the known ones their labels and order, and is
// the fallback if the scan fails.
export const FARM_CREATOR = 'ribbitartwrk'
export const FARMS = [
  { name: 'squish2.exe', version: 'v1', label: 'Floppy Disks' },
  { name: 'squish.bat', version: 'v2', label: 'OG SquishEyez' },
  { name: 'squish.cmd', version: 'v2', label: 'OG SquishEyez II' },
  { name: 'squish.exe', version: 'v1', label: 'First $SQUISH farm' },
]

// WaxDAO blends (contract `waxdaomarket`). The recipe of each is read live
// from the chain, so the page always shows what it really costs and gives.
//   1718 "Wrapz69.exe":   69 SQUISH + Squishdisk (710813) -> Squishdisk 710874
//   1775 "UnwrapZ69.exe": Squishdisk 710874 -> 69 SQUISH
export const BLENDS = [
  { id: 1775, key: 'unwrap', label: 'UNWRAP: CD-R → 69 SQUISH' },
  { id: 1718, key: 'wrap', label: 'WRAP: 69 SQUISH → CD-R' },
]

// NeftyBlocks blends (contract `blend.nefty`): Season 2 Shardz fusion,
// Top Shard + Bottom Shard + Blend Diskette -> completed SquishEye.
export const NEFTY_BLEND_IDS = Array.from({ length: 18 }, (_, i) => 44608 + i)

// NeftyBlocks pack configs (contract `neftyblocksp`) for the collection.
//   1369  Squisheyez Series 1 Pack (template 675219)
//   2133  SquishShardz, Season 2 (template 793828)
export const NEFTY_PACK_IDS = [2133, 1369]

// Return link Anchor opens after signing, so the Android app comes back to
// the front. Registered in android/app/src/main/AndroidManifest.xml.
// Anchor opens this after signing so the Android app comes back to the front
// (registered in android/app/src/main/AndroidManifest.xml).
export const APP_RETURN_URL = 'squishhub://signed'

// Community voting: SquishDAO on WaxDAO's DAO contract (dao.waxdao).
export const DAO_NAME = 'squishdao'
// NFT schemas whose holders vote, one vote per NFT.
export const DAO_SCHEMAS = ['squisheyezs1', 'squisheyezs2']

// SquishEyez × Sk8Coin collab (collection `skatecoinwax` on WAX). The
// SquishEyez Deck and Wheels are parts for a complete SquishEyez skateboard,
// crafted on NeftyBlocks blends with Sk8Coin trucks and SKATE token bearings.
export const SK8 = {
  collection: 'skatecoinwax',
  site: 'https://www.sk8coin.io/',
  parts: [
    { template: 793820, label: 'SquishEyez Deck' },
    { template: 793909, label: 'SquishEyez Wheels (pink)' },
    { template: 793908, label: 'SquishEyez Wheels (white)' },
  ],
  // Live NeftyBlocks drops selling the parts (from pre-made stock).
  dropIds: [218085, 228566, 218115, 228564, 218116, 228565],
  // NeftyBlocks blends that build a SquishEyez skateboard.
  blendIds: [39764, 39765, 39766, 39767, 39768, 39771, 39772],
}
