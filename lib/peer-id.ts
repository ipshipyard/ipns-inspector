import { peerIdFromPrivateKey, peerIdFromPublicKey } from '@libp2p/peer-id'
import type { Ed25519PrivateKey, PublicKey } from '@libp2p/interface'
import { base36 } from 'multiformats/bases/base36'


export function getIPNSNameFromKeypair(privateKey?: Ed25519PrivateKey): string {
  if (!privateKey) return ''
  return peerIdFromPrivateKey(privateKey).toCID().toString(base36)
}

export function getIPNSNameFromPublicKey(publicKey: PublicKey): string {
  return peerIdFromPublicKey(publicKey).toCID().toString(base36)
}
