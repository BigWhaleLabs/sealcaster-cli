import 'colors'
import * as snarkjs from 'snarkjs'
import { BigNumber, Wallet, providers } from 'ethers'
import { Eip1193Bridge } from '@ethersproject/experimental'
import { RelayProvider } from '@opengsn/provider'
import { SCFarcasterLedger__factory } from '@big-whale-labs/seal-cred-ledger-contract'
import { SCPostStorage__factory } from '@big-whale-labs/seal-cred-posts-contract'
import { Scalar } from 'ffjavascript'
import { Web3Provider } from '@ethersproject/providers'
import { WrapBridge } from '@opengsn/provider/dist/WrapContract.js'
import { utils } from 'ethers'
import axios from 'axios'
import buildBabyJub from './circomlibjs/babyjub.js'
import buildMimc7 from './circomlibjs/mimc7.js'
import prompt from 'prompt'

function separator() {
  console.log('🐳'.repeat(20))
}
function emptyLine() {
  console.log()
}

/** Explanation */
emptyLine()
separator()
console.log('👋 Welcome to https://sealcaster.xyz CLI version!'.blue.bold)
console.log(
  '👀 Make sure to have a look at index.js to confirm that nothing fishy is going on.'
    .blue
)
console.log(
  '🤓 Using the following prompts you will cast anonymously to https://sealcaster.xyz and https://fcast.me/sealcaster'
    .blue
)
separator()
emptyLine()

/** Signature */
const message = 'Hello Web3Modal'
console.log(
  `🤙 Please proceed to https://web3modal-dev.pages.dev, connect the wallet you have connected to Farcaster, scroll to "useSignMessage", click "Sign Message", and enter the signature that you've obtained. You may also try to find other means of obtaining a signature of the message "${message}".`
)
console.log(
  '🤙 Note, that https://sealcaster.xyz or this script has no connection to https://web3modal-dev.pages.dev. The only thing this script gets is the signature.'
)
const { signature, message: messageToPost } = await prompt.get({
  properties: {
    signature: {
      description: 'signature (starts with "0x")',
      required: true,
    },
    message: {
      description: 'What message do you want to post? (up to 279 characters)',
      required: true,
      maxLength: 279,
    },
  },
})
const originalAddress = await utils.verifyMessage(message, signature)
console.log(`🤙 Got the signature from ${originalAddress}!`)

emptyLine()
separator()
emptyLine()

/** Burner wallet */
console.log('🔥 Generating a burner wallet...')
export default function relayProvider(provider) {
  return RelayProvider.newProvider({
    provider: new WrapBridge(new Eip1193Bridge(provider.getSigner(), provider)),
    config: {
      paymasterAddress: '0xe66fcE4FA95a94fdE5d277e113012686FFBF28d2',
      preferredRelays: ['https://gsn.sealcred.xyz'],
      blacklistedRelays: ['https://goerli.v3.opengsn.org/v3'],
    },
  }).init()
}
const wallet = Wallet.createRandom()
const defaultProvider = new providers.JsonRpcProvider(
  'https://goerli.sealcred.xyz/rpc',
  'goerli'
)
const gsnProvider = await relayProvider(defaultProvider)
gsnProvider.addAccount(wallet.privateKey)
const ethersProvider = new Web3Provider(gsnProvider)
const signer = ethersProvider.getSigner(wallet.address)
console.log("🔥 Burner wallet's address:", wallet.address)
console.log("🔥 Burner wallet's private key:", wallet.privateKey)
console.log(
  '🔥 Burner wallet is ready! From now on, all actions will be done with the burner wallet. You are SAFU!'
)

emptyLine()
separator()
emptyLine()

/** Attestations */
console.log(
  `📜 Now, we will obtain two attestations: one for the fact that you own ${originalAddress} — and another for the fact that ${originalAddress} is connected to at least one Farcaster account`
)
const baseURL = 'https://verify.sealcred.xyz/v0.2.2/verify'
console.log(`📜 Obtaining the EdDSA public key of the attestor...`)
const { data: eddsaPublicKey } = await axios.get(`${baseURL}/eddsa-public-key`)
console.log(`📜 Got the EdDSA public key of the attestor!`, eddsaPublicKey)
console.log(
  `📜 Obtaining the attestation for the ownership of ${originalAddress}...`
)
const { data: ownershipSignature } = await axios.post(
  `${baseURL}/ethereum-address`,
  {
    signature,
    message,
  }
)
console.log(
  `📜 Obtaining the attestation for the fact that ${originalAddress} is connected to at least one Farcaster account...`
)
const { data: farcasterSignature } = await axios.post(`${baseURL}/farcaster`, {
  address: originalAddress,
})

emptyLine()
separator()
emptyLine()

/** Zero Knowledge proofs */
console.log('🤫 Now to the fun part, generating the zero knowledge proofs!')
const nonce = [
  BigNumber.from(utils.randomBytes(32)).toHexString(),
  BigNumber.from(utils.randomBytes(32)).toHexString(),
]
console.log('🤫 Generated nonce:', nonce)
let babyJub
async function unpackSignature(messageUInt8, packedSignature) {
  const mimc7 = await buildMimc7()
  const M = mimc7.multiHash(messageUInt8)
  // Create BabyJub
  if (!babyJub) {
    babyJub = await buildBabyJub()
  }
  const F = babyJub.F
  // Unpack signature
  const signatureBuffer = utils.arrayify(packedSignature)
  const signature = {
    R8: babyJub.unpackPoint(signatureBuffer.slice(0, 32)),
    S: Scalar.fromRprLE(signatureBuffer, 32, 32),
  }
  if (!signature.R8) throw new Error('Unable to unpack the signature')
  return {
    R8x: F.toObject(signature.R8[0]).toString(),
    R8y: F.toObject(signature.R8[1]).toString(),
    S: signature.S.toString(),
    M: F.toObject(M).toString(),
  }
}
console.log('🤫 Preparing ownership attestation inputs...')
const ownershipMessageBytes = utils.toUtf8Bytes(ownershipSignature.message)
const { R8x, R8y, S } = await unpackSignature(
  ownershipMessageBytes,
  ownershipSignature.signature
)
const ownershipInputs = {
  address: ownershipSignature.message,
  addressPubKeyX: eddsaPublicKey.x,
  addressPubKeyY: eddsaPublicKey.y,
  addressR8x: R8x,
  addressR8y: R8y,
  addressS: S,
}
console.log('🤫 Preparing Farcaster attestation inputs...')
const {
  R8x: R8xF,
  R8y: R8yF,
  S: SF,
} = await unpackSignature(
  farcasterSignature.message,
  farcasterSignature.signature
)
const farcasterInputs = {
  farcasterMessage: farcasterSignature.message,
  farcasterPubKeyX: eddsaPublicKey.x,
  farcasterPubKeyY: eddsaPublicKey.y,
  farcasterR8x: R8xF,
  farcasterR8y: R8yF,
  farcasterS: SF,
}
console.log('🤫 Got all the inputs, generating a Zero Knowledge proof...')
const proofInput = {
  nonce,
  ...ownershipInputs,
  ...farcasterInputs,
}
const proof = await snarkjs.groth16.fullProve(
  proofInput,
  './zk/FarcasterChecker.wasm',
  './zk/FarcasterChecker_final.zkey'
)
console.log('🤫 Congrats! Got the Zero Knowledge proof!')

emptyLine()
separator()
emptyLine()

/** ZK badge minting */
console.log(
  `🪙 Now, we will mint you a ZK badge to the burner wallet ${wallet.address}!`
)
const sealCasterLedger = SCFarcasterLedger__factory.connect(
  '0x55EA2cdCA3a2B63F88104C790705f26Fb340f186',
  signer
)
const mintTxData = {
  a: [BigNumber.from(proof.proof.pi_a[0]), BigNumber.from(proof.proof.pi_a[1])],
  b: [
    [
      BigNumber.from(proof.proof.pi_b[0][1]),
      BigNumber.from(proof.proof.pi_b[0][0]),
    ],
    [
      BigNumber.from(proof.proof.pi_b[1][1]),
      BigNumber.from(proof.proof.pi_b[1][0]),
    ],
  ],
  c: [BigNumber.from(proof.proof.pi_c[0]), BigNumber.from(proof.proof.pi_c[1])],
  input: proof.publicSignals.map(BigNumber.from),
}
const mintTx = await sealCasterLedger.mint(mintTxData)
console.log(
  `🪙 Sending transaction from the burner wallet ${wallet.address}:`,
  mintTx.hash
)
await mintTx.wait()
console.log(
  `🪙 Transaction ${mintTx.hash} completed! You can check it here: https://goerli.etherscan.io/tx/${mintTx.hash}`
)

emptyLine()
separator()
emptyLine()

/** Posting a message */
console.log(
  `📝 You're all set to post a message anonymously from ${wallet.address}!`
)
console.log(
  `📝 Go check out if this address is doxxed or not: https://goerli.etherscan.io/address/${wallet.address}`
)
console.log('📝 Posting the message...')
const postStorageContract = SCPostStorage__factory.connect(
  '0x7CE90c714Dbc48538Ec2838E5e6483155D506AAb',
  signer
)
const postTx = await postStorageContract.savePost(
  messageToPost,
  'farcaster',
  0,
  '0x0000000000000000000000000000000000000000000000000000000000000000'
)
console.log(
  `📝 Sending transaction from the burner wallet ${wallet.address}:`,
  postTx.hash
)
await postTx.wait()
console.log(
  `📝 Transaction ${postTx.hash} completed! You can check it here: https://goerli.etherscan.io/tx/${mintTx.hash}`
)

/** End remarks */
emptyLine()
separator()
console.log('🎉 You did it!'.blue.bold)
console.log('🎉 You posted a message completely anonymously!'.blue)
console.log(
  '🎉 Check your message at https://sealcaster.xyz and https://fcast.me/sealcaster'
    .blue
)
console.log(
  "🎉 Also save your burner wallet private key, you'll be able to reply and follow up with it at https://sealcaster.xyz"
    .blue
)
console.log('🎉 Cheers!'.blue.bold)
separator()
process.exit(0)
