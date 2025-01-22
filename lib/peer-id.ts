import { peerIdFromCID, peerIdFromString, peerIdFromPrivateKey, peerIdFromPublicKey } from '@libp2p/peer-id'
import { CID } from 'multiformats/cid'
import type { PeerId, Ed25519PrivateKey, PublicKey } from '@libp2p/interface'
import { base36 } from 'multiformats/bases/base36'

/**
 * Get a PeerId from a string. 
 * 
 * IPNS favours base36 encoded CIDs, 
 * but it's also possible to use base58btc encoded multihashes (identity or sha256)
 * @see https://github.com/libp2p/specs/blob/master/peer-ids/peer-ids.md#decoding
 */
export function getPeerIdFromString (peerIdString: string): PeerId {
  // It's either base58btc encoded multihash (identity or sha256) 
  if (peerIdString.charAt(0) === '1' || peerIdString.charAt(0) === 'Q') {
    return peerIdFromString(peerIdString)
  }

  // or base36 encoded CID
  return peerIdFromCID(CID.parse(peerIdString))
}


export function getIPNSNameFromKeypair(privateKey: Ed25519PrivateKey): string {
  return peerIdFromPrivateKey(privateKey).toCID().toString(base36)
}

export function getIPNSNameFromPublicKey(publicKey: PublicKey): string {
  return peerIdFromPublicKey(publicKey).toCID().toString(base36)
}
