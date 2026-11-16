// NeftyBlocks blends on `blend.nefty` (Season 2 Shardz fusion).
//
// A deterministic, non-secure blend is one transaction:
//   1. blend.nefty::announcedepo { owner, count }
//   2. atomicassets::transfer  NFTs -> blend.nefty, memo "deposit"
//   3. blend.nefty::nosecfuse  { claimer, blend_id, transferred_assets, own_assets: [] }
// The contract burns the deposited NFTs and mints the result in the same
// transaction. Blends that cost tokens, are gated (security_id != 0) or roll
// random results need more steps and are shown but not offered here.
import { getRow, getOwnedAssets, templateLabel } from './chain.js'
import { act, actor } from './wallet.js'
import { COLLECTION, NEFTY_BLEND_IDS } from './config.js'

const CONTRACT = 'blend.nefty'

function parseDisplay(s) {
  try { return JSON.parse(s || '{}') } catch { return {} }
}

function decode(row) {
  const ingredients = (row.ingredients || []).map(([type, d]) =>
    type === 'TEMPLATE_INGREDIENT'
      ? { kind: 'template', template_id: Number(d.template_id), amount: Number(d.amount) || 1 }
      : { kind: 'unsupported', type })
  const outcomes = (row.rolls || []).flatMap((r) => r.outcomes || [])
  const results = outcomes.flatMap((o) => o.results || [])
    .filter(([type]) => type === 'ON_DEMAND_NFT_RESULT')
    .map(([, d]) => Number(d.template_id))
  const deterministic = (row.rolls || []).every((r) => (r.outcomes || []).length === 1)
  const now = Date.now() / 1000
  const ended = Number(row.end_time) > 0 && Number(row.end_time) < now
  const notStarted = Number(row.start_time) > now
  const soldOut = Number(row.max) > 0 && Number(row.use_count) >= Number(row.max)
  const display = parseDisplay(row.display_data)
  const supported = deterministic && Number(row.security_id) === 0 && ingredients.every((i) => i.kind === 'template')
  return {
    id: String(row.blend_id),
    name: display.name || `Blend #${row.blend_id}`,
    image: display.image || '',
    category: row.category || '',
    ingredients,
    results,
    status: ended ? 'ended' : notStarted ? 'not started' : soldOut ? 'sold out' : 'active',
    supported,
  }
}

export async function loadNeftyBlends() {
  const rows = await Promise.all(NEFTY_BLEND_IDS.map((id) => getRow(CONTRACT, 'blends', id).catch(() => undefined)))
  const blends = rows.filter((r) => r && r.collection_name === COLLECTION).map(decode)
  const ids = new Set(blends.flatMap((b) => [...b.ingredients.map((i) => i.template_id), ...b.results]).filter(Boolean))
  const names = new Map(await Promise.all([...ids].map(async (id) => [id, await templateLabel(COLLECTION, id)])))
  for (const b of blends) {
    b.ingredientText = b.ingredients.map((i) => `${i.amount} × ${names.get(i.template_id) || i.type}`).join(' + ')
    b.resultText = b.results.map((t) => names.get(t).replace(/ \(.*\)$/, '')).join(' + ') || '—'
  }
  return blends
}

/** The wallet's collection NFTs grouped by template, for matching recipes. */
export async function ownedByTemplate() {
  const byTemplate = new Map()
  for (const a of await getOwnedAssets(actor(), { collection_name: COLLECTION })) {
    const t = Number(a.template?.template_id ?? a.template_id ?? 0)
    if (!t || a.is_transferable === false || a.is_burnable === false) continue
    if (!byTemplate.has(t)) byTemplate.set(t, [])
    byTemplate.get(t).push(String(a.asset_id))
  }
  return byTemplate
}

/** Asset IDs for every ingredient, or the name of the first missing one. */
export function pick(blend, owned) {
  const used = new Set()
  const ids = []
  for (const ing of blend.ingredients) {
    const free = (owned.get(ing.template_id) || []).filter((id) => !used.has(id))
    if (free.length < ing.amount) return { missing: ing }
    free.slice(0, ing.amount).forEach((id) => { used.add(id); ids.push(id) })
  }
  return { ids }
}

export function buildFuse(blend, assetIds) {
  const user = actor()
  return [
    act(CONTRACT, 'announcedepo', { owner: user, count: assetIds.length }),
    act('atomicassets', 'transfer', { from: user, to: CONTRACT, asset_ids: assetIds, memo: 'deposit' }),
    act(CONTRACT, 'nosecfuse', { claimer: user, blend_id: blend.id, transferred_assets: assetIds, own_assets: [] }),
  ]
}
