// SquishEyez drops on NeftyBlocks (`neftyblocksd`) and NFTHive
// (`nfthivedrops`): read and claim. Shapes come from the live ABIs and from
// real claim transactions.
//
// Claim
//   NeftyBlocks  [assertprice] + [token transfer, memo "deposit"] + claimdrop | claimdropwl | claimwproof
//   NFTHive                      [token transfer, memo "deposit"] + claimdrop | claimdropwl | claimwproof
//   (paid parts are skipped for free drops)
// Neither contract indexes drops by collection, so the drops found by the
// chain scan are read by ID and only newer IDs are scanned for new drops.
import { COLLECTION } from './config.js'
import { getRow, getTableRows, getOwnedAssets, getCurrencyBalance, amountOf, atomic, templateLabel, schemaName } from './chain.js'
import { act, actor } from './wallet.js'

export const PLATFORMS = {
  nefty: {
    key: 'nefty', name: 'NeftyBlocks', contract: 'neftyblocksd', configTable: 'config',
    knownIds: [172101, 187923, 188322, 238112, 238113, 238114, 238115, 238226, 238229, 238230, 238231, 238272, 238273, 238274],
    statsTable: 'accstats', wlTable: 'whitelists', proofTable: 'proofown',
    referrer: 'SquishHub',
    link: (id) => `https://neftyblocks.com/collection/${COLLECTION}/drops/${id}`,
  },
  hive: {
    key: 'hive', name: 'NFTHive', contract: 'nfthivedrops', configTable: 'newconfig',
    knownIds: [5589, 6236, 6291, 6304, 6516, 6606, 6678, 6990, 6994, 7089, 7520, 8025, 8182, 8183, 8191, 8192, 8213, 8214, 8215, 8425],
    statsTable: 'accounts', wlTable: 'whitelist', proofTable: 'dropproof',
    referrer: '', // a `name` on NFTHive
    link: (id) => `https://nfthive.io/drop/${id}`,
  },
}

const now = () => Math.floor(Date.now() / 1000)
export const isFree = (price) => !price || amountOf(price) === 0 || /NULL$/.test(price)
export const symbolOf = (quantity) => {
  const [q, sym] = String(quantity).trim().split(/\s+/)
  return `${(q.split('.')[1] || '').length},${sym}`
}
const multiply = (quantity, n) => {
  const [q, sym] = String(quantity).split(' ')
  const p = (q.split('.')[1] || '').length
  return `${(Number(q) * n).toFixed(p)} ${sym}`
}

// ---------------------------------------------------------------- reading

const tokenRegistry = new Map()
/** symbol code -> token contract, from the platform's own config. */
async function tokenContract(platform, symbolCode) {
  if (symbolCode === 'WAX') return 'eosio.token'
  if (!tokenRegistry.has(platform.key)) {
    tokenRegistry.set(platform.key, getTableRows({ code: platform.contract, table: platform.configTable, limit: 1 })
      .then(([cfg]) => new Map((cfg?.supported_tokens || []).map((t) => [t.token_symbol.split(',')[1], t.token_contract]))))
  }
  const map = await tokenRegistry.get(platform.key)
  if (!map.has(symbolCode)) throw new Error(`${platform.name} does not list a contract for ${symbolCode}.`)
  return map.get(symbolCode)
}

function parseDisplay(s) {
  try { return JSON.parse(s || '{}') } catch { return { name: String(s || '') } }
}

function decode(platform, r) {
  const d = parseDisplay(r.display_data)
  const max = Number(r.max_claimable) || 0
  const claimed = Number(r.current_claimed) || 0
  const start = Number(r.start_time) || 0
  const end = Number(r.end_time) || 0
  const price = String(r.listing_price)
  const settlement = String(r.settlement_symbol)
  const status = max > 0 && claimed >= max ? 'sold out'
    : start > now() ? 'upcoming'
      : end > 0 && end < now() ? 'ended' : 'live'
  return {
    platform: platform.key,
    id: String(r.drop_id),
    collection: r.collection_name,
    name: d.name || `Drop #${r.drop_id}`,
    description: d.description || '',
    image: d.image || d.img || '',
    display: d,
    templates: (r.assets_to_mint || []).map((a) => Number(a.template_id)),
    usesPool: (r.assets_to_mint || []).some((a) => Number(a.use_pool ?? a.pool_id ?? 0) > 0),
    price,
    settlement,
    free: isFree(price),
    // Priced in one symbol and settled in another (e.g. USD via an oracle).
    oraclePriced: !isFree(price) && symbolOf(price) !== settlement && !/NULL/.test(settlement),
    recipient: r.price_recipient,
    authRequired: Boolean(Number(r.auth_required)),
    hidden: Boolean(Number(r.is_hidden)),
    max, claimed,
    remaining: max > 0 ? Math.max(0, max - claimed) : Infinity,
    accountLimit: Number(r.account_limit) || 0,
    cooldown: Number(r.account_limit_cooldown) || 0,
    start, end, status,
  }
}

async function readDropRow(platform, id) {
  const r = await getRow(platform.contract, 'drops', id)
  return r && String(r.drop_id) === String(id) ? r : undefined
}

/** Every drop of the collection on one platform, newest first. */
export async function loadDrops(platformKey, { includeTail = true } = {}) {
  const platform = PLATFORMS[platformKey]
  const known = (await Promise.all(platform.knownIds.map((id) => readDropRow(platform, id).catch(() => undefined)))).filter(Boolean)
  let fresh = []
  if (includeTail) {
    let lower = Math.max(...platform.knownIds) + 1
    for (let i = 0; i < 10; i++) {
      const res = await getTableRows({ code: platform.contract, table: 'drops', lower, limit: 1000 })
      fresh.push(...res.filter((r) => r.collection_name === COLLECTION))
      if (res.length < 1000) break
      lower = Number(res[res.length - 1].drop_id) + 1
    }
  }
  const seen = new Set()
  return [...fresh, ...known]
    .filter((r) => r.collection_name === COLLECTION && !seen.has(String(r.drop_id)) && seen.add(String(r.drop_id)))
    .map((r) => decode(platform, r))
    .sort((a, b) => Number(b.id) - Number(a.id))
}

/** Specific drops by ID (any collection), in the order given. */
export async function loadDropsByIds(platformKey, ids) {
  const platform = PLATFORMS[platformKey]
  const rows = await Promise.all(ids.map((id) => readDropRow(platform, id).catch(() => undefined)))
  return rows.filter(Boolean).map((r) => decode(platform, r))
}

export async function reloadDrop(drop) {
  const r = await readDropRow(PLATFORMS[drop.platform], drop.id)
  return r ? decode(PLATFORMS[drop.platform], r) : undefined
}

/** Alternative prices a drop accepts (both contracts keep them in `dropprices`). */
export async function alternativePrices(drop) {
  const platform = PLATFORMS[drop.platform]
  const row = await getRow(platform.contract, 'dropprices', drop.id).catch(() => undefined)
  if (!row || String(row.drop_id) !== drop.id) return []
  return (row.alternative_prices || row.listing_prices || []).map(String).filter((p) => p !== drop.price)
}

// ------------------------------------------------------------ access rules

/**
 * Who may claim: public, a whitelist, NFT ownership, or an auth key (which
 * needs a signature from the creator and cannot be claimed from here).
 * Filters are normalised to { collection, schema?, template?, amount, cmp }.
 */
export async function readAccess(drop) {
  if (!drop.authRequired) return { kind: 'public' }
  const platform = PLATFORMS[drop.platform]
  const wl = await getTableRows({ code: platform.contract, scope: drop.id, table: platform.wlTable, limit: 1000 }).catch(() => [])
  if (wl.length) return { kind: 'whitelist', accounts: wl.map((r) => String(r.account)) }
  const proof = await getRow(platform.contract, platform.proofTable, drop.id).catch(() => undefined)
  if (proof && String(proof.drop_id) === drop.id) {
    if (drop.platform === 'nefty') {
      const filters = (proof.group?.filters || []).map(([type, p]) => ({
        type,
        collection: p.collection_name,
        schema: p.schema_name || undefined,
        template: p.template_id !== undefined ? Number(p.template_id) : undefined,
        amount: Number(p.amount ?? 1),
        cmp: Number(p.comparison_operator ?? 3),
        token: type === 'TOKEN_HOLDING' ? { contract: p.token_contract, symbol: p.token_symbol, amount: p.amount } : undefined,
      }))
      await nameTemplates(filters)
      return { kind: 'proof', any: Number(proof.group?.logical_operator) === 1, filters }
    }
    // NFTHive: PROOF_GROUP[] { op: "AND" | "OR", proof: [{ num, collection_name, schema, template_id }] }
    const groups = proof.proof || []
    const filters = groups.flatMap((g) => (g.proof || []).map((p) => ({
      type: p.template_id > 0 ? 'TEMPLATE_HOLDINGS' : p.schema ? 'SCHEMA_HOLDINGS' : 'COLLECTION_HOLDINGS',
      collection: p.collection_name,
      schema: p.schema || undefined,
      template: p.template_id > 0 ? Number(p.template_id) : undefined,
      amount: Number(p.num) || 1,
      cmp: 3,
    })))
    await nameTemplates(filters)
    return { kind: 'proof', any: groups.some((g) => String(g.op).toUpperCase() === 'OR'), filters }
  }
  if (drop.platform === 'nefty') {
    const keys = await getTableRows({ code: platform.contract, scope: drop.id, table: 'authkeys', limit: 1 }).catch(() => [])
    if (keys.length) return { kind: 'authkey' }
  }
  return { kind: 'closed' }
}

async function nameTemplates(filters) {
  await Promise.all(filters.filter((f) => f.template).map(async (f) => { f.label = await templateLabel(f.collection, f.template) }))
}

export function describeAccess(access) {
  switch (access.kind) {
    case 'public': return 'Everyone'
    case 'whitelist': return `Whitelisted accounts only (${access.accounts.length})`
    case 'proof': return `Holders of ${access.filters.map(describeFilter).join(access.any ? ' or ' : ' and ')}`
    case 'authkey': return 'Only with a claim key from the creator (not available in this app)'
    default: return 'Nobody yet (restricted, but no list has been set)'
  }
}

export function describeFilter(f) {
  if (f.type === 'TOKEN_HOLDING') return `at least ${f.token?.amount}`
  const what = f.template ? (f.label || `template #${f.template}`) : f.schema ? schemaName(f.schema) : f.collection === COLLECTION ? 'SquishEyez' : f.collection
  const n = Number(f.amount) || 1
  return `${n} ${what} NFT${n === 1 ? '' : 's'}`
}

const matches = (f, a) =>
  a.collection?.collection_name === f.collection &&
  (f.schema === undefined || a.schema?.schema_name === f.schema) &&
  (f.template === undefined || Number(a.template?.template_id) === f.template)

/** NFT IDs proving ownership, or the first filter the wallet does not meet. */
export async function resolveProof(access) {
  const owner = actor()
  const collections = [...new Set(access.filters.filter((f) => f.collection).map((f) => f.collection))]
  const owned = (await Promise.all(collections.map((c) => getOwnedAssets(owner, { collection_name: c })))).flat()
  const picks = new Set()
  let met = 0
  let firstUnmet
  for (const f of access.filters) {
    if (access.any && met) break
    if (f.type === 'TOKEN_HOLDING') {
      const [bal] = await getCurrencyBalance(f.token.contract, owner, String(f.token.symbol).split(',')[1]).catch(() => [])
      if (amountOf(bal) >= amountOf(f.token.amount)) met++
      else firstUnmet = firstUnmet || f
      continue
    }
    const need = Math.max(1, f.cmp === 2 ? f.amount + 1 : f.amount)
    const have = owned.filter((a) => matches(f, a))
    if (have.length < need) { firstUnmet = firstUnmet || f; continue }
    const ordered = [...have.filter((a) => picks.has(String(a.asset_id))), ...have.filter((a) => !picks.has(String(a.asset_id)))]
    ordered.slice(0, need).forEach((a) => picks.add(String(a.asset_id)))
    met++
  }
  const ok = access.any ? met > 0 : met === access.filters.length
  return ok ? { assetIds: [...picks] } : { missing: firstUnmet }
}

/** How many more times the wallet may claim (Infinity when unlimited). */
export async function claimsLeft(drop) {
  if (!drop.accountLimit) return Infinity
  const platform = PLATFORMS[drop.platform]
  const row = await getRow(platform.contract, platform.statsTable, drop.id, actor()).catch(() => undefined)
  if (!row || String(row.drop_id) !== drop.id) return drop.accountLimit
  if (drop.cooldown > 0 && now() > Number(row.last_claim_time) + drop.cooldown) return drop.accountLimit
  return Math.max(0, drop.accountLimit - Number(row.counter || 0))
}

/** Leftover deposits a wallet can withdraw from a drop contract. */
export async function leftoverBalances(platformKey) {
  const platform = PLATFORMS[platformKey]
  const row = await getRow(platform.contract, 'balances', actor()).catch(() => undefined)
  if (!row || String(row.owner ?? row.user) !== actor()) return []
  return (row.quantities || []).map(String).filter((q) => amountOf(q) > 0)
}

// ---------------------------------------------------------------- claiming

/**
 * price: the price paid per claim (the listing price or an alternative).
 * access: from readAccess; proofIds when access.kind === 'proof'.
 */
export async function buildClaim(drop, { amount = 1, price = drop.price, access, proofIds = [] } = {}) {
  const platform = PLATFORMS[drop.platform]
  const claimer = actor()
  const out = []
  if (drop.oraclePriced) throw new Error('This drop is priced in US dollars, which this app can\'t pay yet.')
  if (access.kind === 'authkey') throw new Error('This drop needs a claim key from the creator.')
  if (access.kind === 'closed') throw new Error('Nobody can claim this drop yet.')
  if (access.kind === 'whitelist' && !access.accounts.includes(claimer)) throw new Error('Your account is not on this drop\'s whitelist.')

  const free = isFree(price)
  const currency = free ? '0,NULL' : symbolOf(price)
  if (!free) {
    if (drop.platform === 'nefty') {
      out.push(act(platform.contract, 'assertprice', { drop_id: drop.id, listing_price: price, settlement_symbol: drop.settlement }))
    }
    const contract = await tokenContract(platform, currency.split(',')[1])
    out.push(act(contract, 'transfer', { from: claimer, to: platform.contract, quantity: multiply(price, amount), memo: 'deposit' }))
  }
  const base = {
    claimer, drop_id: drop.id, amount, intended_delphi_median: '0', referrer: platform.referrer,
  }
  const tail = drop.platform === 'nefty'
    ? { country: '', currency, referrer_account: '' }
    : { country: '', currency }
  const name = access.kind === 'whitelist' ? 'claimdropwl' : access.kind === 'proof' ? 'claimwproof' : 'claimdrop'
  const data = name === 'claimwproof' ? { ...base, asset_ids: proofIds, ...tail } : { ...base, ...tail }
  out.push(act(platform.contract, name, data))
  return out
}

export function buildWithdrawLeftover(platformKey, quantity) {
  const platform = PLATFORMS[platformKey]
  return platformKey === 'nefty'
    ? [act(platform.contract, 'withdraw', { owner: actor(), token_to_withdraw: quantity })]
    : [act(platform.contract, 'withdraw', { account: actor(), amount: quantity })]
}
