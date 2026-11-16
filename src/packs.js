// NeftyBlocks packs on `neftyblocksp`.
//
// Opening is two transactions (commit / reveal):
//   1. atomicassets::transfer the pack NFT to neftyblocksp, memo "unbox".
//   2. The WAX RNG oracle answers, and neftyblocksp writes a `claimassets`
//      row whose claim_id is the pack's asset_id. Then
//      neftyblocksp::claim { claim_id, roll_indexes: [0..n-1] } mints the
//      contents to the wallet.
// A pack that was sent but never claimed stays in `claimassets`, so
// entering its asset ID again finishes the claim.
import { getRow, getTableRows, getOwnedAssets, sleep } from './chain.js'
import { act, actor } from './wallet.js'
import { NEFTY_PACK_IDS } from './config.js'

const CONTRACT = 'neftyblocksp'

let packTemplates

/** Template IDs of the collection's pack NFTs, from the pack configs. */
export async function getPackTemplates() {
  if (!packTemplates) {
    packTemplates = Promise.all(NEFTY_PACK_IDS.map((id) => getRow(CONTRACT, 'packs', id).catch(() => undefined)))
      .then((rows) => rows.filter(Boolean).map((r) => ({
        pack_id: Number(r.pack_id),
        template_id: Number(r.pack_template_id),
        collection: r.collection_name,
      })))
    packTemplates.catch(() => { packTemplates = undefined })
  }
  return packTemplates
}

/** Pack NFTs the connected wallet holds. */
export async function listOwnedPacks() {
  const templates = await getPackTemplates()
  const out = []
  for (const t of templates) {
    const assets = await getOwnedAssets(actor(), { collection_name: t.collection, template_id: t.template_id })
    for (const a of assets) out.push({ asset_id: a.asset_id, name: a.name || a.template?.immutable_data?.name || 'Pack' })
  }
  return out
}

export async function getClaim(assetId) {
  const rows = await getTableRows({ code: CONTRACT, table: 'claimassets', lower: assetId, limit: 1 })
  const row = rows[0]
  return row && String(row.claim_id) === String(assetId) ? row : undefined
}

export function buildUnbox(assetId) {
  return [act('atomicassets', 'transfer', { from: actor(), to: CONTRACT, asset_ids: [String(assetId)], memo: 'unbox' })]
}

export function buildClaim(row) {
  const n = Math.max(1, (row.claims || []).length)
  return [act(CONTRACT, 'claim', { claim_id: String(row.claim_id), roll_indexes: Array.from({ length: n }, (_, i) => i) })]
}

/** Polls until the oracle has staged the pack's contents. */
export async function waitForClaim(assetId, { timeoutMs = 120_000, onTick } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    onTick?.(Math.round((Date.now() - start) / 1000))
    const row = await getClaim(assetId).catch(() => undefined)
    if (row && (row.claims || []).length) return row
    await sleep(2000)
  }
  throw new Error('The roll is taking longer than usual. Your pack is safe: come back later, enter the same pack ID and tap OPEN PACK to collect your NFTs.')
}

/** Bytes the collection has deposited with neftyblocksp for pack openings. */
export async function collectionRam(collection) {
  const row = await getRow(CONTRACT, 'rambalances', collection)
  return row && row.collection_name === collection ? Number(row.byte_balance) : 0
}
