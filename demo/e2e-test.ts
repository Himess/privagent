/**
 * End-to-end test on Base Sepolia:
 * 1. Deposit USDC into ShieldedPool
 * 2. Generate real ZK proof (Groth16)
 * 3. Withdraw USDC to a different address
 *
 * Usage: PRIVATE_KEY=0x... npx tsx demo/e2e-test.ts
 */
import { ethers } from "ethers";
import { buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ===================== Config =====================
const RPC_URL = process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error("Set PRIVATE_KEY env var");
  process.exit(1);
}

const POOL_ADDRESS = "0x11c8ebc9A95B2A1DA4155b167dadA9B5925dde8f";
const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const CIRCUIT_WASM = path.resolve(__dirname, "../circuits/build/privatePayment_js/privatePayment.wasm");
const CIRCUIT_ZKEY = path.resolve(__dirname, "../circuits/build/privatePayment_final.zkey");
const CIRCUIT_VKEY = path.resolve(__dirname, "../circuits/build/verification_key.json");

// ===================== ABIs =====================
const POOL_ABI = [
  "function deposit(uint256 amount, bytes32 commitment) external",
  "function withdraw(address recipient, uint256 amount, bytes32 nullifierHash, bytes32 newCommitment, bytes32 merkleRoot, address relayer, uint256 fee, uint256[8] calldata proof) external",
  "function getLastRoot() external view returns (bytes32)",
  "function getTreeInfo() external view returns (uint256, uint256, bytes32)",
  "function getBalance() external view returns (uint256)",
  "function nextLeafIndex() external view returns (uint256)",
  "function isKnownRoot(bytes32 root) external view returns (bool)",
  "event Deposited(address indexed depositor, uint256 amount, bytes32 indexed commitment, uint256 leafIndex)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

// ===================== Poseidon Setup =====================
let poseidon: any;
let F: any;

function hash2(a: bigint, b: bigint): bigint {
  return F.toObject(poseidon([a, b]));
}

function randomField(): bigint {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  const FIELD_SIZE = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
  return BigInt("0x" + Buffer.from(bytes).toString("hex")) % FIELD_SIZE;
}

// ===================== Incremental Merkle Tree =====================
class SparseMerkleTree {
  private leaves: bigint[] = [];
  private zeroValues: bigint[];
  private filledSubtrees: bigint[];
  private currentRoot: bigint;
  private depth: number;

  constructor(depth: number) {
    this.depth = depth;
    this.zeroValues = [0n];
    let z = 0n;
    for (let i = 1; i <= depth; i++) {
      z = hash2(z, z);
      this.zeroValues.push(z);
    }
    this.filledSubtrees = this.zeroValues.slice(0, depth);
    this.currentRoot = this.zeroValues[depth];
  }

  addLeaf(commitment: bigint): number {
    const index = this.leaves.length;
    this.leaves.push(commitment);

    let currentHash = commitment;
    let currentIndex = index;
    for (let i = 0; i < this.depth; i++) {
      if (currentIndex % 2 === 0) {
        this.filledSubtrees[i] = currentHash;
        currentHash = hash2(currentHash, this.zeroValues[i]);
      } else {
        currentHash = hash2(this.filledSubtrees[i], currentHash);
      }
      currentIndex = Math.floor(currentIndex / 2);
    }
    this.currentRoot = currentHash;
    return index;
  }

  getRoot(): bigint {
    return this.currentRoot;
  }

  private getNode(level: number, index: number): bigint {
    const subtreeStart = index * (2 ** level);
    if (subtreeStart >= this.leaves.length) return this.zeroValues[level];
    if (level === 0) return this.leaves[index];
    return hash2(this.getNode(level - 1, index * 2), this.getNode(level - 1, index * 2 + 1));
  }

  getProof(leafIndex: number) {
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let currentIndex = leafIndex;

    for (let level = 0; level < this.depth; level++) {
      const isLeft = currentIndex % 2 === 0;
      const siblingIndex = isLeft ? currentIndex + 1 : currentIndex - 1;
      pathElements.push(this.getNode(level, siblingIndex));
      pathIndices.push(isLeft ? 0 : 1);
      currentIndex = Math.floor(currentIndex / 2);
    }

    return { pathElements, pathIndices, root: this.currentRoot };
  }
}

// ===================== Main =====================
async function main() {
  console.log("=== GhostPay E2E Test (Base Sepolia) ===\n");

  // Check circuit artifacts exist
  for (const f of [CIRCUIT_WASM, CIRCUIT_ZKEY, CIRCUIT_VKEY]) {
    if (!fs.existsSync(f)) {
      console.error(`Missing circuit artifact: ${f}`);
      console.error("Run circuits/scripts/build.sh first");
      process.exit(1);
    }
  }

  // Setup
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const pool = new ethers.Contract(POOL_ADDRESS, POOL_ABI, signer);
  const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);

  const signerAddr = await signer.getAddress();
  console.log(`Wallet:  ${signerAddr}`);
  console.log(`Pool:    ${POOL_ADDRESS}`);

  // Check balances
  const ethBal = await provider.getBalance(signerAddr);
  const usdcBal = await usdc.balanceOf(signerAddr);
  console.log(`ETH:     ${ethers.formatEther(ethBal)}`);
  console.log(`USDC:    ${Number(usdcBal) / 1e6}\n`);

  if (BigInt(usdcBal) < 2_000_000n) {
    console.error("Need at least 2 USDC for this test");
    process.exit(1);
  }

  // Init Poseidon
  console.log("Initializing Poseidon...");
  poseidon = await buildPoseidon();
  F = poseidon.F;

  // Sync existing tree from on-chain events
  console.log("Syncing Merkle tree from on-chain events...");
  const tree = new SparseMerkleTree(20);
  const iface = new ethers.Interface(POOL_ABI);
  const filter = pool.filters.Deposited();
  // Query only recent blocks (public RPCs limit to 10K block range)
  const currentBlock = await provider.getBlockNumber();
  const fromBlock = Math.max(0, currentBlock - 9000);
  const events = await pool.queryFilter(filter, fromBlock, "latest");
  for (const ev of events) {
    const parsed = iface.parseLog({ topics: ev.topics as string[], data: ev.data });
    if (parsed) tree.addLeaf(BigInt(parsed.args.commitment));
  }
  console.log(`  Existing leaves: ${events.length}`);

  // =================== STEP 1: Deposit ===================
  console.log("\n--- Step 1: Deposit 2 USDC ---");

  const depositAmount = 2_000_000n; // 2 USDC
  const balance = depositAmount;
  const randomness = randomField();
  const nullifierSecret = randomField();
  const commitment = hash2(balance, randomness);

  console.log(`  Commitment: ${commitment.toString().slice(0, 20)}...`);

  // Approve USDC
  const allowance = await usdc.allowance(signerAddr, POOL_ADDRESS);
  if (BigInt(allowance) < depositAmount) {
    console.log("  Approving USDC...");
    const approveTx = await usdc.approve(POOL_ADDRESS, ethers.MaxUint256);
    await approveTx.wait();
    console.log(`  Approved: ${approveTx.hash}`);
  }

  // Deposit
  const commitmentBytes32 = ethers.zeroPadValue(ethers.toBeHex(commitment), 32);
  console.log("  Sending deposit tx...");
  const depositTx = await pool.deposit(depositAmount, commitmentBytes32);
  const depositReceipt = await depositTx.wait();
  console.log(`  TX: ${depositTx.hash}`);
  console.log(`  Block: ${depositReceipt.blockNumber}`);
  console.log(`  Gas used: ${depositReceipt.gasUsed.toString()}`);

  // Extract leaf index from event
  let leafIndex = -1;
  for (const log of depositReceipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === "Deposited") {
        leafIndex = Number(parsed.args.leafIndex);
        break;
      }
    } catch {}
  }
  console.log(`  Leaf index: ${leafIndex}`);

  // Update local tree
  tree.addLeaf(commitment);

  // Verify roots match
  const onChainRoot = BigInt(await pool.getLastRoot());
  const localRoot = tree.getRoot();
  console.log(`  On-chain root: ${onChainRoot.toString().slice(0, 20)}...`);
  console.log(`  Local root:    ${localRoot.toString().slice(0, 20)}...`);
  console.log(`  Roots match:   ${onChainRoot === localRoot}`);

  if (onChainRoot !== localRoot) {
    console.error("ROOT MISMATCH! Aborting.");
    process.exit(1);
  }

  // =================== STEP 2: Generate ZK Proof ===================
  console.log("\n--- Step 2: Generate ZK Proof ---");

  const withdrawAmount = 1_000_000n; // 1 USDC
  const fee = 0n;
  const recipient = "0x000000000000000000000000000000000000dEaD"; // burn address for test

  const nullifierHash = hash2(nullifierSecret, commitment);
  const change = balance - withdrawAmount - fee;
  const newRandomness = randomField();
  const newCommitment = hash2(change, newRandomness);

  const merkleProof = tree.getProof(leafIndex);

  const circuitInput = {
    // Private
    balance: balance.toString(),
    randomness: randomness.toString(),
    nullifierSecret: nullifierSecret.toString(),
    newRandomness: newRandomness.toString(),
    pathElements: merkleProof.pathElements.map((e: bigint) => e.toString()),
    pathIndices: merkleProof.pathIndices.map((i: number) => i.toString()),
    // Public
    root: merkleProof.root.toString(),
    nullifierHash: nullifierHash.toString(),
    recipient: BigInt(recipient).toString(),
    amount: withdrawAmount.toString(),
    relayer: "0",
    fee: fee.toString(),
  };

  console.log("  Generating Groth16 proof...");
  const startTime = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInput,
    CIRCUIT_WASM,
    CIRCUIT_ZKEY
  );
  const proofTime = Date.now() - startTime;
  console.log(`  Proof generated in ${proofTime}ms`);

  // Verify locally
  const vkey = JSON.parse(fs.readFileSync(CIRCUIT_VKEY, "utf8"));
  const localValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  console.log(`  Local verification: ${localValid ? "VALID" : "INVALID"}`);

  if (!localValid) {
    console.error("Local proof verification failed! Aborting.");
    process.exit(1);
  }

  // Log public signals
  console.log(`  Public signals:`);
  console.log(`    [0] newCommitment: ${publicSignals[0].toString().slice(0, 20)}...`);
  console.log(`    [1] root:          ${publicSignals[1].toString().slice(0, 20)}...`);
  console.log(`    [2] nullifierHash: ${publicSignals[2].toString().slice(0, 20)}...`);
  console.log(`    [3] recipient:     ${publicSignals[3]}`);
  console.log(`    [4] amount:        ${publicSignals[4]}`);
  console.log(`    [5] relayer:       ${publicSignals[5]}`);
  console.log(`    [6] fee:           ${publicSignals[6]}`);

  // =================== STEP 3: Withdraw with ZK Proof ===================
  console.log("\n--- Step 3: Withdraw 1 USDC with ZK Proof ---");

  // Format proof for contract (CRITICAL: pi_b swap for BN254)
  const pA: [bigint, bigint] = [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])];
  const pB: [[bigint, bigint], [bigint, bigint]] = [
    [BigInt(proof.pi_b[0][1]), BigInt(proof.pi_b[0][0])],
    [BigInt(proof.pi_b[1][1]), BigInt(proof.pi_b[1][0])],
  ];
  const pC: [bigint, bigint] = [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])];

  const proofArray = [pA[0], pA[1], pB[0][0], pB[0][1], pB[1][0], pB[1][1], pC[0], pC[1]];

  const newCommitmentBytes32 = ethers.zeroPadValue(ethers.toBeHex(newCommitment), 32);
  const nullifierHashBytes32 = ethers.zeroPadValue(ethers.toBeHex(nullifierHash), 32);
  const rootBytes32 = ethers.zeroPadValue(ethers.toBeHex(merkleProof.root), 32);

  console.log("  Sending withdraw tx...");
  const withdrawTx = await pool.withdraw(
    recipient,
    withdrawAmount,
    nullifierHashBytes32,
    newCommitmentBytes32,
    rootBytes32,
    ethers.ZeroAddress, // no relayer
    0n,                 // no fee
    proofArray
  );

  const withdrawReceipt = await withdrawTx.wait();
  console.log(`  TX: ${withdrawTx.hash}`);
  console.log(`  Block: ${withdrawReceipt.blockNumber}`);
  console.log(`  Gas used: ${withdrawReceipt.gasUsed.toString()}`);

  // =================== STEP 4: Verify Results ===================
  console.log("\n--- Step 4: Verify Results ---");

  const poolBalance = await pool.getBalance();
  const recipientBalance = await usdc.balanceOf(recipient);
  const [nextLeaf] = await pool.getTreeInfo();

  console.log(`  Pool USDC balance:      ${Number(poolBalance) / 1e6} USDC`);
  console.log(`  Recipient USDC balance: ${Number(recipientBalance) / 1e6} USDC`);
  console.log(`  Next leaf index:        ${nextLeaf}`);

  // Expected: pool = deposit - withdraw = 2 - 1 = 1 USDC (as change commitment)
  // Recipient should have 1 USDC more
  const poolExpected = Number(depositAmount - withdrawAmount) / 1e6;
  const poolActual = Number(poolBalance) / 1e6;

  console.log(`\n  Pool balance expected:  ${poolExpected} USDC`);
  console.log(`  Pool balance actual:    ${poolActual} USDC`);

  if (poolActual >= poolExpected) {
    console.log("\n=== E2E TEST PASSED ===");
    console.log("Deposit -> ZK Proof -> Withdraw working on Base Sepolia!");
  } else {
    console.log("\n=== E2E TEST FAILED ===");
  }
}

main().catch((err) => {
  console.error("\nE2E Test Error:", err);
  process.exit(1);
});
