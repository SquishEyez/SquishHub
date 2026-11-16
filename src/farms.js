// WaxDAO NFT farms: farm details, what a wallet can stake, stake / unstake /
// claim. Verified against the live ABIs and real transactions:
//
//   v1  waxdaofarmer (custodial: the NFTs move to the contract)
//       stake    waxdaofarmer::assertstake { user, farmname, assets_to_assert }
//                + atomicassets::transfer -> waxdaofarmer, memo "|stake|<farm>|"
//       unstake  waxdaofarmer::unstakemany { asset_ids, user, farmname }
//       claim    waxdaofarmer::claimrewards { farm, user }
//       per-user rows: table stakebackup, index 2 (user)
//
//   v2  farms.waxdao (non-custodial: the NFTs stay in the wallet)
//       stake    farms.waxdao::stakenfts { user, farmname, assets_to_stake }
//       unstake  farms.waxdao::unstake   { user, farmname, asset_ids }
//       claim    farms.waxdao::claim     { user, farmname }
//       per-user rows: table stakers, index 3 (user)
//       eligible NFTs + rates: tables valuesbytemp / valuesbysch / valuesbycol,
//       scope = farm name
import { getTableRows, getRow, atomic, amountOf } from './chain.js'
import { FARMS, FARM_CREATOR } from './config.js'
import { act, actor, openIfNeeded } from './wallet.js'

const V1 = 'waxdaofarmer'
const V2 = 'farms.waxdao'
const now = () => Date.now() / 1000

const byUser = (code, table, index, user) =>
  getTableRows({ code, table, index, keyType: 'name', lower: user, upper: user, limit: 500 })

/** The farm's rules and state, read live. */
export async function readFarmInfo(name, version) {
  if (version === 'v1') {
    const f = await getRow(V1, 'farms', name)
    if (!f || f.farmname !== name) return { name, version, exists: false }
    const rules = f.farmtype === 'template'
      ? (f.templates || []).map((t) => ({ collection: f.collection, template_id: Number(t) }))
      : f.farmtype === 'schema'
        ? [{ collection: f.collection, schema: f.schema }]
        : [...new Set([f.collection, ...(f.collections || [])].filter(Boolean))].map((c) => ({ collection: c }))
    const ended = Number(f.enddate) < now()
    const empty = amountOf(f.poolsize) <= 0
    return {
      name, version, exists: true,
      logo: f.logo || '',
      rules,
      // hourly_cap is the per-NFT hourly rate in the token's smallest unit;
      // hourlyreward is what the whole farm pays per hour right now.
      // hourly_cap is the per-NFT hourly rate in the token's smallest unit;
      // hourlyreward is what the whole farm pays per hour right now.
      perNft: (() => {
        const [q, sym] = String(f.poolsize).split(' ')
        const p = (q.split('.')[1] || '').length
        return `${(Number(f.hourly_cap) / 10 ** p).toFixed(p)} ${sym}`
      })(),
      rate: `${(Number(f.hourly_cap) / 10 ** ((String(f.poolsize).split(' ')[0].split('.')[1] || '').length))} ${String(f.poolsize).split(' ')[1]}/hr per NFT`,
      pool: f.poolsize,
      rewards: [{ contract: f.contract, quantity: f.poolsize }],
      ends: Number(f.enddate) * 1000,
      lockSeconds: Number(f.mintime) || 0,
      limit: Number(f.template_limit) || 0,
      totalStaked: Number(f.totalstaked) || 0,
      open: !ended && !empty && Number(f.allow_new_members) !== 0,
      status: ended ? 'ended' : empty ? 'reward pool empty' : Number(f.allow_new_members) === 0 ? 'closed to new stakers' : 'live',
    }
  }
  const f = await getRow(V2, 'farms', name)
  if (!f || f.farmname !== name) return { name, version, exists: false }
  const [byTemp, bySch, byCol] = await Promise.all(['valuesbytemp', 'valuesbysch', 'valuesbycol']
    .map((table) => getTableRows({ code: V2, scope: name, table, limit: 500 }).catch(() => [])))
  const rate = (rv) => (rv || []).map((r) => r.quantity).join(' + ')
  const rules = [
    ...byTemp.map((r) => ({ collection: r.collection_name, template_id: Number(r.template_id), rate: rate(r.reward_values) })),
    ...bySch.map((r) => ({ collection: r.collection_name, schema: r.schema_name, rate: rate(r.reward_values) })),
    ...byCol.map((r) => ({ collection: r.collection_name, rate: rate(r.reward_values) })),
  ]
  const expired = Number(f.expiration) < now()
  const opened = Number(f.status) === 1
  const pool = (f.reward_pools || []).map((p) => p.total_funds).join(' + ')
  return {
    name, version, exists: true,
    rules,
    logo: f.profile?.avatar || '',
    perNft: rules.length ? rules[0].rate : '',
    rate: rules.length ? `${rules[0].rate}/hr per NFT` : '',
    pool,
    rewards: (f.reward_pools || []).map((p) => ({ contract: p.contract, quantity: p.total_funds })),
    ends: Number(f.expiration) * 1000,
    lockSeconds: 0,
    totalStaked: Number(f.total_staked) || 0,
    hoursBetweenPayouts: Number(f.hours_between_payouts) || 0,
    open: opened && !expired,
    status: !opened ? 'not opened' : expired ? 'ended' : 'live',
  }
}

/** Every v1 / v2 stake row the wallet has, any farm. */
export async function readUserStakes() {
  const user = actor()
  const [v1, v2] = await Promise.all([
    byUser(V1, 'stakebackup', 'secondary', user).catch(() => []),
    byUser(V2, 'stakers', 'tertiary', user).catch(() => []),
  ])
  const out = new Map()
  for (const r of v1.filter((r) => r.username === user)) {
    out.set(`v1:${r.farmname}`, {
      name: r.farmname, version: 'v1',
      assets: (r.assets || []).map(String),
      claimable: amountOf(r.claimable) > 0 ? [r.claimable] : [],
      unlock: Number(r.unlocktime) * 1000,
    })
  }
  for (const r of v2.filter((r) => r.user === user)) {
    const claim = (r.claimable_balances || []).filter((c) => amountOf(c.quantity) > 0)
    out.set(`v2:${r.farmname}`, {
      name: r.farmname, version: 'v2',
      assets: (r.asset_ids || []).map(String),
      claimable: claim.map((c) => c.quantity),
      claimRewards: claim,
      unlock: 0,
    })
  }
  return out
}

/** Whether an AtomicAssets asset is accepted by a farm's rules. */
export function eligible(asset, farm) {
  const coll = asset.collection?.collection_name || asset.collection_name
  const schema = asset.schema?.schema_name || asset.schema_name
  const tid = Number(asset.template?.template_id ?? asset.template_id ?? 0)
  return (farm.rules || []).some((r) =>
    r.collection === coll &&
    (r.template_id === undefined || r.template_id === tid) &&
    (r.schema === undefined || r.schema === schema))
}

/** Details of specific assets (e.g. the ones a v1 farm holds for the wallet). */
export async function assetsById(ids) {
  const out = []
  for (let i = 0; i < ids.length; i += 100) {
    out.push(...(await atomic(`/atomicassets/v1/assets?ids=${ids.slice(i, i + 100).join(',')}&limit=100`)))
  }
  return out
}

async function opensFor(rewards) {
  const out = []
  const seen = new Set()
  for (const r of rewards || []) {
    const key = `${r.contract}:${String(r.quantity).split(' ')[1]}`
    if (!r.contract || !r.quantity || seen.has(key)) continue
    seen.add(key)
    out.push(...(await openIfNeeded(r.contract, r.quantity)))
  }
  return out
}

export function buildStake(farm, assetIds) {
  const user = actor()
  const ids = assetIds.map(String)
  if (farm.version === 'v1') {
    return [
      act(V1, 'assertstake', { user, farmname: farm.name, assets_to_assert: ids }),
      act('atomicassets', 'transfer', { from: user, to: V1, asset_ids: ids, memo: `|stake|${farm.name}|` }),
    ]
  }
  return [act(V2, 'stakenfts', { user, farmname: farm.name, assets_to_stake: ids })]
}

export async function buildUnstake(farm, assetIds) {
  const user = actor()
  const ids = assetIds.map(String)
  const opens = await opensFor(farm.rewards)
  if (farm.version === 'v1') {
    return [...opens, act(V1, 'unstakemany', { asset_ids: ids, user, farmname: farm.name })]
  }
  return [...opens, act(V2, 'unstake', { user, farmname: farm.name, asset_ids: ids })]
}

export async function buildClaim(farm, stake) {
  const user = actor()
  const opens = await opensFor([...(farm.rewards || []), ...(stake?.claimRewards || [])])
  if (farm.version === 'v1') return [...opens, act(V1, 'claimrewards', { farm: farm.name, user })]
  return [...opens, act(V2, 'claim', { user, farmname: farm.name })]
}

// ------------------------------------------------------------ farm list

let farmList
/**
 * Every farm FARM_CREATOR owns on both contracts (so farms created later
 * appear without an app update), labelled from config where known. Falls
 * back to the configured list when the scan cannot be read.
 */
export function getFarmList({ fresh = false } = {}) {
  if (!farmList || fresh) {
    farmList = (async () => {
      const scan = async (code) => {
        const rows = []
        let lower
        for (let i = 0; i < 10; i++) {
          const res = await getTableRows({ code, table: 'farms', lower, limit: 1000 })
          rows.push(...res)
          if (res.length < 1000) break
          lower = String(BigInt(String(res[res.length - 1].ID ?? res[res.length - 1].id ?? 0)) + 1n)
          if (code === V2) lower = undefined // farms.waxdao is keyed by name; 138 rows fit in one read
          if (!lower) break
        }
        return rows.filter((r) => r.creator === FARM_CREATOR)
      }
      const [v1, v2] = await Promise.all([scan(V1), scan(V2)])
      const known = new Map(FARMS.map((f) => [`${f.version}:${f.name}`, f]))
      const found = [
        ...v1.map((r) => ({ name: r.farmname, version: 'v1' })),
        ...v2.map((r) => ({ name: r.farmname, version: 'v2', blurb: r.profile?.description })),
      ].map((f) => ({ ...f, label: known.get(`${f.version}:${f.name}`)?.label || (f.blurb || '').split('\n')[0].slice(0, 40) || 'SquishEyez farm' }))
      const order = (f) => { const i = FARMS.findIndex((k) => k.name === f.name); return i < 0 ? -1 : i }
      return found.length ? found.sort((a, b) => order(a) - order(b)) : FARMS
    })().catch(() => FARMS)
  }
  return farmList
}
