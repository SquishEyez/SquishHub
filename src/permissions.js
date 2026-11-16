// Permission links (eosio::linkauth) of the connected account. An account can
// require a specific permission for a contract or action; a transaction signed
// with any other is refused ("Irrelevant authority included"), so actions are
// signed with whatever permission the wallet's own settings require.
import { rpc } from './chain.js'

export async function loadLinks(account) {
  const links = []
  try {
    const acc = await rpc('/v1/chain/get_account', { account_name: account })
    for (const p of acc.permissions || []) {
      for (const l of p.linked_actions || []) links.push({ code: l.account, action: l.action || '', perm: p.perm_name })
    }
  } catch { /* none known: the session's own permission is used */ }
  return links
}

/** The permission to sign `account::name` with, given the session's permission. */
export function permissionFor(links, sessionPermission, account, name) {
  const exact = links.find((l) => l.code === account && l.action === name)
  const any = links.find((l) => l.code === account && !l.action)
  const linked = (exact || any)?.perm
  // owner satisfies every link, so an owner session is left alone.
  if (!linked || sessionPermission === 'owner' || linked === sessionPermission) return sessionPermission
  return linked
}
