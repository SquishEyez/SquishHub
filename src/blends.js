// WaxDAO blends on `waxdaomarket` (used for $SQUISH wrap / unwrap).
//
// A blend is one transaction:
//   1. waxdaomarket::assertblend { blend_ID, user, unique_id }
//   2. one transfer per ingredient, in recipe order, each with the memo
//      "|blend_deposit|<blend_ID>|<slot>|" where <slot> is the ingredient's
//      index in the recipe (tokens included):
//        token -> <token contract>::transfer to waxdaomarket
//        NFT   -> atomicassets::transfer      to waxdaomarket
import { getRow, getOwnedAssets, getCurrencyBalance, amountOf, templateLabel, templateData, fmtQty } from './chain.js'
import { act, actor } from './wallet.js'

const CONTRACT = 'waxdaomarket'

function decodeIngredient(ing) {
  if (ing.ingredient_type === 'fungible') {
    const [precStr, symbol] = String(ing.fungible_token_symbol).split(',')
    const precision = Number(precStr) || 0
    return {
      kind: 'token',
      contract: ing.fungible_token_contract,
      symbol,
      quantity: `${Number(ing.fungible_token_amount).toFixed(precision)} ${symbol}`,
    }
  }
  return {
    kind: 'nft',
    filter: ing.filter_by,
    collection_name: ing.collection_name,
    schema_name: ing.schema_name,
    template_id: Number(ing.template_id) || 0,
    amount: Number(ing.non_fungible_quantity) || 1,
    burn: Boolean(Number(ing.burn_non_fungible) || ing.burn_non_fungible === true),
    attributes: ing.required_attributes || [],
  }
}

function decodeResult(r) {
  if (r.result_type === 'fungible' || r.fungible_token_contract) {
    const [precStr, symbol] = String(r.fungible_token_symbol || '').split(',')
    if (symbol) {
      return { kind: 'token', text: `${Number(r.fungible_token_amount).toFixed(Number(precStr) || 0)} ${symbol}` }
    }
  }
  const n = Number(r.non_fungible_quantity) || 1
  return { kind: 'nft', amount: n, collection: r.collection_name, template_id: Number(r.template_id) || 0, text: `${n} × NFT` }
}

function status(row) {
  const now = Date.now() / 1000
  const max = Number(row.max_blends || 0)
  if (max > 0 && Number(row.blends_remaining || 0) === 0) return 'sold out'
  if (Number(row.start_time || 0) > now) return 'not started'
  const end = Number(row.end_time || 0)
  if (end > 0 && end < now && end < 1e11) return 'ended'
  return 'active'
}

export async function loadBlend(id) {
  const row = await getRow(CONTRACT, 'blends', id)
  if (!row || String(row.ID) !== String(id)) throw new Error(`Blend #${id} not found on ${CONTRACT}`)
  const ingredients = (row.blend_ingredients || []).map(decodeIngredient)
  const results = (row.blend_results || []).map(decodeResult)
  // Name templates from their on-chain data (the recipe's own labels can be placeholders).
  await Promise.all([
    ...ingredients.filter((i) => i.kind === 'nft' && i.filter === 'template').map(async (i) => { i.label = await templateLabel(i.collection_name, i.template_id); i.image = (await templateData(i.collection_name, i.template_id)).img }),
    ...results.filter((r) => r.kind === 'nft' && r.template_id).map(async (r) => { r.text = `${r.amount} × ${await templateLabel(r.collection, r.template_id)}`; r.image = (await templateData(r.collection, r.template_id)).img }),
  ])
  return {
    id: String(row.ID),
    title: row.blend_title || `Blend #${row.ID}`,
    status: status(row),
    remaining: Number(row.max_blends || 0) > 0 ? Number(row.blends_remaining) : null,
    whitelist: row.whitelist_type,
    ingredients,
    results,
  }
}

export function describeIngredient(ing) {
  if (ing.kind === 'token') return fmtQty(ing.quantity)
  const what =
    ing.filter === 'template' ? (ing.label || `template #${ing.template_id}`) :
    ing.filter === 'schema' ? `any "${ing.schema_name}" NFT` :
    ing.filter === 'collection' ? `any ${ing.collection_name} NFT` :
    `"${ing.schema_name}" NFT with ${ing.attributes.map((a) => `${a.name}=${a.value}`).join(', ')}`
  return `${ing.amount} × ${what}${ing.burn ? ' (burned)' : ''}`
}

function matchesAttributes(asset, attrs) {
  const data = { ...(asset.immutable_data || {}), ...(asset.mutable_data || {}), ...(asset.data || {}) }
  return attrs.every((a) => String(data[a.name] ?? '') === String(a.value ?? ''))
}

/**
 * Picks NFTs from the wallet for every NFT slot (never the same asset twice)
 * and checks token balances. Throws with a clear message when something is
 * missing.
 */
export async function pickIngredients(blend) {
  const owner = actor()
  const used = new Set()
  const picks = new Map()
  const cache = new Map()

  for (const [slot, ing] of blend.ingredients.entries()) {
    if (ing.kind === 'token') {
      const bal = await getCurrencyBalance(ing.contract, owner, ing.symbol).catch(() => [])
      const have = amountOf(bal[0])
      if (have + 1e-12 < amountOf(ing.quantity)) {
        throw new Error(`You need ${fmtQty(ing.quantity)}, but your wallet has ${fmtQty(bal[0] || `0 ${ing.symbol}`)}.`)
      }
      continue
    }
    const filters = { collection_name: ing.collection_name }
    if (ing.filter !== 'collection' && ing.schema_name) filters.schema_name = ing.schema_name
    if (ing.filter === 'template') filters.template_id = ing.template_id
    const key = JSON.stringify(filters)
    if (!cache.has(key)) cache.set(key, await getOwnedAssets(owner, filters))
    const candidates = cache.get(key).filter((a) =>
      !used.has(a.asset_id) &&
      a.is_transferable !== false &&
      (!ing.burn || a.is_burnable !== false) &&
      (ing.filter !== 'attributes' && ing.filter !== 'attribute' ? true : matchesAttributes(a, ing.attributes)))
    if (candidates.length < ing.amount) {
      throw new Error(`You're missing ${describeIngredient(ing)} (you have ${candidates.length}).`)
    }
    const chosen = candidates.slice(0, ing.amount).map((a) => a.asset_id)
    chosen.forEach((id) => used.add(id))
    picks.set(slot, chosen)
  }
  return picks
}

export function buildBlendActions(blend, picks) {
  const user = actor()
  const uniqueId = String(Date.now() * 1000 + Math.floor(Math.random() * 1000))
  const memo = (slot) => `|blend_deposit|${blend.id}|${slot}|`
  const actions = [act(CONTRACT, 'assertblend', { blend_ID: blend.id, user, unique_id: uniqueId })]
  for (const [slot, ing] of blend.ingredients.entries()) {
    if (ing.kind === 'token') {
      actions.push(act(ing.contract, 'transfer', { from: user, to: CONTRACT, quantity: ing.quantity, memo: memo(slot) }))
    } else {
      actions.push(act('atomicassets', 'transfer', { from: user, to: CONTRACT, asset_ids: picks.get(slot), memo: memo(slot) }))
    }
  }
  return actions
}
