export {
  UTXO,
  SerializedUTXO,
  V4_MERKLE_DEPTH,
  V4_MAX_LEAVES,
  randomFieldElement,
  derivePublicKey,
  computeCommitmentV4,
  computeNullifierV4,
  createUTXO,
  createDummyUTXO,
  serializeUTXO,
  deserializeUTXO,
} from "./utxo.js";

export {
  Keypair,
  generateKeypair,
  keypairFromPrivateKey,
  serializeKeypair,
  deserializeKeypair,
} from "./keypair.js";

export {
  CoinSelectionResult,
  selectUTXOs,
  getAvailableBalance,
} from "./coinSelection.js";

export {
  CircuitArtifacts,
  JoinSplitInput,
  JoinSplitProofResult,
  selectCircuit,
  generateJoinSplitProof,
  proofToArray,
} from "./joinSplitProver.js";

export { ExtData, computeExtDataHash } from "./extData.js";

export { encryptNote, decryptNote } from "./noteEncryption.js";

export { syncTreeFromEvents, getSpentNullifiers } from "./treeSync.js";

export {
  ShieldedWallet,
  ShieldedWalletConfig,
  TransactResult,
  GenerateTransactProofResult,
} from "./shieldedWallet.js";
