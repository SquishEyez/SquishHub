// NeftyBlocks blends on `blend.nefty`: Season 2 Shardz fusion and the
// SquishEyez × Sk8Coin skateboards.
//
// A deterministic, non-secure blend is one transaction:
//   1. blend.nefty::announcedepo { owner, count }
//   2. atomicassets::transfer  NFTs -> blend.nefty, memo "deposit"
//   3. blend.nefty::nosecfuse  { claimer, blend_id, transferred_assets, own_assets: [] }
// The contract burns the deposited NFTs and mints the result in the same
// transaction (a pool result is drawn from pre-made NFTs and arrives a moment
// later). Blends that cost tokens, are gated (security_id != 0) or roll
// between several outcomes need more steps and are shown but not offered here.
import { getRow, getOwnedAssets, templateLabel, templateData } from './chain.js'
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
  const pool = outcomes.flatMap((o) => o.results || [])
    .filter(([type]) => type === 'POOL_NFT_RESULT')
    .map(([, d]) => ({ name: d.pool_name, ...parseDisplay(d.display_data) }))[0]
  const deterministic = (row.rolls || []).every((r) => (r.outcomes || []).length === 1)
  const now = Date.now() / 1000
  const ended = Number(row.end_time) > 0 && Number(row.end_time) < now
  const notStarted = Number(row.start_time) > now
  const soldOut = Number(row.max) > 0 && Number(row.use_count) >= Number(row.max)
  const display = parseDisplay(row.display_data)
  const supported = deterministic && Number(row.security_id) === 0 && ingredients.every((i) => i.kind === 'template')
  return {
    id: String(row.blend_id),
    collection: row.collection_name,
    max: Number(row.max) || 0,
    used: Number(row.use_count) || 0,
    pool,
    name: display.name || `Blend #${row.blend_id}`,
    image: display.image || '',
    category: row.category || '',
    ingredients,
    results,
    status: ended ? 'ended' : notStarted ? 'not started' : soldOut ? 'sold out' : 'active',
    supported,
  }
}

/** The given blends of one collection, with names, images and supply filled in. */
export async function loadNeftyBlends(blendIds = NEFTY_BLEND_IDS, collection = COLLECTION) {
  const rows = await Promise.all(blendIds.map((id) => getRow(CONTRACT, 'blends', id).catch(() => undefined)))
  const blends = rows.filter((r) => r && r.collection_name === collection).map(decode)
  const ids = new Set(blends.flatMap((b) => [...b.ingredients.map((i) => i.template_id), ...b.results]).filter(Boolean))
  const info = new Map(await Promise.all([...ids].map(async (id) => [id, {
    label: await templateLabel(collection, id),
    data: await templateData(collection, id),
  }])))
  for (const b of blends) {
    for (const i of b.ingredients) Object.assign(i, { label: info.get(i.template_id)?.label, image: info.get(i.template_id)?.data.img })
    b.ingredientText = b.ingredients.map((i) => `${i.amount} × ${i.label || i.type}`).join(' + ')
    b.resultText = b.results.map((t) => info.get(t).label.replace(/ \(.*\)$/, '')).join(' + ') || (b.pool ? `one from the ${b.pool.name || 'prize'} pool` : '—')
    b.resultData = b.results[0] ? info.get(b.results[0])?.data : undefined
    if (!b.image) b.image = b.resultData?.img || b.pool?.image || ''
    // A result template whose whole supply exists can never be minted again.
    const r = b.resultData
    if (r && r._max > 0 && r._issued >= r._max) b.status = 'already made'
  }
  return blends
}

/** The wallet's NFTs of a collection grouped by template, for matching recipes. */
export async function ownedByTemplate(collection = COLLECTION) {
  const byTemplate = new Map()
  for (const a of await getOwnedAssets(actor(), { collection_name: collection })) {
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
