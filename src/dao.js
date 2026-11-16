// Community voting through WaxDAO's DAO contract (`dao.waxdao`).
//
// SquishDAO is a "type 5" DAO: holders of the governance schemas vote by
// naming the NFTs they hold, one vote per NFT. Nothing is staked or locked.
// Every format below was checked on WAX mainnet with compute_transaction:
//
//   propose   dao.waxdao::announcedepo + WAX fee "|proposal_payment|" + newproposal
//   vote      dao.waxdao::vote { user, dao, proposal_id, choice, asset_ids }
//   finalize  dao.waxdao::finalize { user, dao, proposal_id } (after the end time)
//
// Proposals live in table `proposals` (scope = DAO name); who voted with which
// NFTs is in `votesbyprop` (scope = proposal id).
import { COLLECTION, DAO_NAME, DAO_SCHEMAS } from './config.js'
import { getRow, getTableRows, getOwnedAssets } from './chain.js'
import { act, actor } from './wallet.js'

const C = 'dao.waxdao'


/** The DAO row and its profile, or undefined when it does not exist yet. */
export async function readDao(name = DAO_NAME) {
  const row = await getRow(C, 'daos', name)
  if (!row || row.daoname !== name) return undefined
  const profile = await getRow(C, 'daoprofiles', name).catch(() => undefined)
  return { ...row, profile: profile?.daoname === name ? profile.profile : undefined }
}

const now = () => Date.now() / 1000

function decodeProposal(p) {
  const total = Number(p.total_votes) || 0
  const choices = (p.choices || []).map((c) => ({ choice: Number(c.choice), text: c.description, votes: Number(c.total_votes) || 0 }))
  const top = [...choices].sort((a, b) => b.votes - a.votes)[0]
  const end = Number(p.end_time)
  return {
    id: String(p.proposal_id),
    author: p.author,
    title: p.title,
    description: p.description,
    type: Number(p.proposal_type),
    choices,
    total,
    leading: total ? top : undefined,
    created: Number(p.time_created),
    end,
    open: end > now(),
    finalized: Number(p.outcome) !== 0,
  }
}

/** Every proposal of the DAO, newest first. */
export async function listProposals(name = DAO_NAME) {
  const rows = await getTableRows({ code: C, scope: name, table: 'proposals', limit: 500 })
  return rows.map(decodeProposal).sort((a, b) => Number(b.id) - Number(a.id))
}

/** Who has voted on a proposal, and with which NFTs. */
export async function votesFor(proposalId) {
  const rows = await getTableRows({ code: C, scope: String(proposalId), table: 'votesbyprop', limit: 1000 }).catch(() => [])
  return rows.map((r) => ({ wallet: String(r.wallet), assets: (r.asset_ids || []).map(String) }))
}

/** The wallet's NFTs that can vote (governance schemas), minus any already used on this proposal. */
export async function votingNfts(dao, proposalId) {
  const schemas = (dao?.gov_schemas || DAO_SCHEMAS.map((s) => ({ collection_name: COLLECTION, schema_name: s })))
  const owned = (await Promise.all(schemas.map((s) => getOwnedAssets(actor(), { collection_name: s.collection_name, schema_name: s.schema_name })))).flat()
  const used = new Set((await votesFor(proposalId)).flatMap((v) => v.assets))
  return {
    usable: owned.filter((a) => !used.has(String(a.asset_id))).map((a) => String(a.asset_id)),
    owned: owned.length,
  }
}

export function buildVote(proposal, choice, assetIds, dao = DAO_NAME) {
  return [act(C, 'vote', { user: actor(), dao, proposal_id: proposal.id, choice, asset_ids: assetIds })]
}

export function buildFinalize(proposal, dao = DAO_NAME) {
  return [act(C, 'finalize', { user: actor(), dao, proposal_id: proposal.id })]
}

/**
 * New proposal. type 0 = multiple choice (any options), 4 = Yes / No / Abstain.
 * `fee` is the DAO's proposal_cost (e.g. "0.10000000 WAX").
 */
export function buildProposal({ title, description, type = 0, options }, fee, dao = DAO_NAME) {
  const user = actor()
  const texts = type === 4 ? ['Yes', 'No', 'Abstain'] : options
  const t = (title || '').trim()
  if (t.length < 4 || t.length > 100) throw new Error('The title must be 4–100 characters.')
  if (!texts || texts.length < 2) throw new Error('Add at least two options.')
  const desc = (description || '').trim()
  if (desc.length < 4 || desc.length > 2500) throw new Error('The description must be 4–2,500 characters.')
  const pay = Number(String(fee).split(' ')[0]) > 0
    ? [act(C, 'announcedepo', { user }), act('eosio.token', 'transfer', { from: user, to: C, quantity: fee, memo: '|proposal_payment|' })]
    : []
  return [
    ...pay,
    act(C, 'newproposal', {
      user, dao, proposal_type: type, title: t, description: desc,
      choices: texts.map((t, i) => ({ choice: i, description: String(t).trim(), total_votes: '0' })),
      token_receivers: [], nft_receivers: [], proof_asset_ids: [],
    }),
  ]
}
