// Read-only access to WAX: table rows, balances and AtomicAssets lookups,
// with failover across public nodes.
import { WAX_RPC_ENDPOINTS, ATOMIC_API_ENDPOINTS } from './config.js'

const TIMEOUT_MS = 10_000

let preferredRpc = 0

async function fetchJson(url, init) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = body?.error?.details?.[0]?.message || body?.message || `HTTP ${res.status}`
      throw new Error(msg)
    }
    return body
  } finally {
    clearTimeout(timer)
  }
}

/** POST to a chain API path, trying each node until one answers. */
export async function rpc(path, params) {
  let lastErr
  for (let i = 0; i < WAX_RPC_ENDPOINTS.length; i++) {
    const idx = (preferredRpc + i) % WAX_RPC_ENDPOINTS.length
    try {
      const out = await fetchJson(WAX_RPC_ENDPOINTS[idx] + path, {
        method: 'POST',
        body: JSON.stringify(params),
      })
      preferredRpc = idx
      return out
    } catch (err) {
      lastErr = err
    }
  }
  throw new Error(`WAX nodes unreachable: ${lastErr?.message || lastErr}`)
}

export async function getTableRows({ code, scope = code, table, lower, upper, limit = 100, index, keyType, reverse }) {
  const params = { json: true, code, scope, table, limit }
  if (lower !== undefined) params.lower_bound = String(lower)
  if (upper !== undefined) params.upper_bound = String(upper)
  if (index) params.index_position = index
  if (keyType) params.key_type = keyType
  if (reverse) params.reverse = true
  const res = await rpc('/v1/chain/get_table_rows', params)
  return res.rows || []
}

/** One row by primary key, or undefined. */
export async function getRow(code, table, key, scope = code) {
  const rows = await getTableRows({ code, scope, table, lower: key, upper: key, limit: 1 })
  return rows[0]
}

/** e.g. ["12.0000 SQUISH"], or [] when the account has no balance row. */
export async function getCurrencyBalance(contract, account, symbol) {
  return rpc('/v1/chain/get_currency_balance', { code: contract, account, symbol })
}

const abiCache = new Map()
export function getAbi(account) {
  if (!abiCache.has(account)) {
    abiCache.set(account, rpc('/v1/chain/get_abi', { account_name: account }).then((r) => r.abi))
  }
  return abiCache.get(account)
}

/** GET an AtomicAssets API path (starting with /), returning `data`. */
export async function atomic(path) {
  let lastErr
  for (const base of ATOMIC_API_ENDPOINTS) {
    try {
      const body = await fetchJson(base + path)
      if (body.success === false) throw new Error(body.message || 'AtomicAssets API error')
      return body.data
    } catch (err) {
      lastErr = err
    }
  }
  throw new Error(`AtomicAssets API unreachable: ${lastErr?.message || lastErr}`)
}

/** Every asset `owner` holds that matches the given filters (up to 1000). */
export async function getOwnedAssets(owner, filters = {}) {
  const out = []
  for (let page = 1; page <= 10; page++) {
    const q = new URLSearchParams({ owner, page: String(page), limit: '100', order: 'asc', sort: 'asset_id' })
    for (const [k, v] of Object.entries(filters)) if (v !== undefined && v !== '') q.set(k, String(v))
    const rows = await atomic(`/atomicassets/v1/assets?${q}`)
    out.push(...rows)
    if (rows.length < 100) break
  }
  return out
}

/**
 * A token amount for reading: "69.000000000 SQUISH" -> "69 SQUISH",
 * "31617.950700000 SQUISH" -> "31,617.9507 SQUISH". Display only; actions
 * always use the exact on-chain string.
 */
export function fmtQty(q) {
  const m = String(q ?? '').trim().match(/^(-?\d+(?:\.\d+)?)\s+([A-Z][A-Z0-9]{0,6})$/)
  if (!m) return String(q ?? '')
  const [, n, sym] = m
  if (sym === 'NULL' || Number(n) === 0) return sym === 'NULL' ? 'free' : `0 ${sym}`
  return `${Number(n).toLocaleString('en-GB', { maximumFractionDigits: 8 })} ${sym}`
}

/** Friendly names for the collection's schemas (falls back to the raw name). */
export const SCHEMA_NAMES = {
  squisheyezs1: 'OG SquishEyez',
  squisheyezs2: 'Season 2 SquishEyez',
  squishdiskz: 'Squishdiskz',
  squishshardz: 'SquishShardz',
  squishpacks: 'SquishEyez packs',
  squishartz: 'SquishArtz',
}
export const schemaName = (s) => SCHEMA_NAMES[s] || s

/** "19 Dec 2025, 01:39" in the viewer's own locale; '' for 0. */
export const fmtDate = (unixSeconds) => (unixSeconds > 0
  ? new Date(unixSeconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  : '')

/** "3 days", "1 hour", "17 minutes". */
export function fmtDuration(seconds) {
  const unit = (n, w) => `${+n.toFixed(1)} ${w}${+n.toFixed(1) === 1 ? '' : 's'}`
  if (seconds >= 86400) return unit(seconds / 86400, 'day')
  if (seconds >= 3600) return unit(seconds / 3600, 'hour')
  if (seconds >= 60) return unit(Math.round(seconds / 60), 'minute')
  return unit(seconds, 'second')
}

export const amountOf = (quantity) => parseFloat(String(quantity ?? '').split(' ')[0]) || 0

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const templates = new Map()
/** A template's immutable data (cached), or {} when it cannot be read. */
export function templateData(collection, id) {
  const key = `${collection}:${id}`
  if (!templates.has(key)) {
    templates.set(key, atomic(`/atomicassets/v1/templates/${collection}/${id}`)
      .then((t) => ({ ...(t?.immutable_data || {}), schema: t?.schema?.schema_name }))
      .catch(() => ({})))
  }
  return templates.get(key)
}

/**
 * Readable name for a collection template, with the traits that tell
 * look-alikes apart, e.g. "SquishShard (Top, V 9.0, Doodlez)".
 */
export async function templateLabel(collection, id) {
  const d = await templateData(collection, id)
  const traits = ['Shard', 'Piece', 'Style', 'Type', 'Size'].map((k) => d[k]).filter(Boolean)
  return d.name ? `${d.name}${traits.length ? ` (${traits.join(', ')})` : ''}` : `template #${id}`
}
