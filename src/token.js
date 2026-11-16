// $SQUISH at a glance: supply against the 963,369 cap, what sits in farm
// reward pools, and how many wallets hold it. Read-only.
import { SQUISH_TOKEN } from './config.js'
import { rpc, getTableRows, getCurrencyBalance, amountOf } from './chain.js'

/** The cap is fixed on chain; this is only used if the chain can't be read. */
export const SQUISH_CAP = 963369
const FARM_CONTRACTS = ['waxdaofarmer', 'farms.waxdao']

async function holderCount() {
  let count = 0
  let lower
  for (let i = 0; i < 20; i++) {
    const res = await rpc('/v1/chain/get_table_by_scope', { code: SQUISH_TOKEN.contract, table: 'accounts', limit: 1000, ...(lower ? { lower_bound: lower } : {}) })
    count += (res.rows || []).length
    if (!res.more) break
    lower = res.more
  }
  return count
}

export async function squishStats() {
  const [stat] = await getTableRows({ code: SQUISH_TOKEN.contract, scope: SQUISH_TOKEN.symbol, table: 'stat', limit: 1 })
  const supply = amountOf(stat?.supply)
  const cap = amountOf(stat?.max_supply) || SQUISH_CAP
  const [pools, holders] = await Promise.all([
    Promise.all(FARM_CONTRACTS.map((c) => getCurrencyBalance(SQUISH_TOKEN.contract, c, SQUISH_TOKEN.symbol).then((b) => amountOf(b[0])).catch(() => 0))),
    holderCount().catch(() => undefined),
  ])
  return {
    supply, cap,
    left: Math.max(0, cap - supply),
    pct: cap ? (supply / cap) * 100 : 0,
    inFarms: pools.reduce((a, b) => a + b, 0),
    holders,
    precision: (String(stat?.supply).split(' ')[0].split('.')[1] || '').length || 9,
  }
}
