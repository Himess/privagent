export const POOL_ADDRESS = process.env.NEXT_PUBLIC_POOL_ADDRESS || "0x8F1ae8209156C22dFD972352A415880040fB0b0c";
export const USDC_ADDRESS = process.env.NEXT_PUBLIC_USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const DEPLOY_BLOCK = 38347380;
export const CHAIN_ID = 84532;
export const BLOCKSCOUT_TX = "https://base-sepolia.blockscout.com/tx/";
export const BLOCKSCOUT_ADDR = "https://base-sepolia.blockscout.com/address/";

export const CONTRACTS = {
  PoseidonHasher: "0x3ae70C9741a9959fA32bC9BC09959d3d319Ee3Cd",
  Verifier_1x2: "0xe473aF953d269601402DEBcB2cc899aB594Ad31e",
  Verifier_2x2: "0x10D5BB24327d40c4717676E3B7351D76deb33848",
  ShieldedPoolV4: POOL_ADDRESS,
};

export const POOL_ABI = [
  "function transact((uint256[2] pA, uint256[2][2] pB, uint256[2] pC, bytes32 root, int256 publicAmount, bytes32 extDataHash, uint256 protocolFee, bytes32[] inputNullifiers, bytes32[] outputCommitments, uint8[] viewTags) args, (address recipient, address relayer, uint256 fee, bytes encryptedOutput1, bytes encryptedOutput2) extData) external",
  "function getLastRoot() view returns (bytes32)",
  "function isKnownRoot(bytes32) view returns (bool)",
  "function nullifiers(bytes32) view returns (bool)",
  "function nextLeafIndex() view returns (uint256)",
  "function getBalance() view returns (uint256)",
  "function getTreeInfo() view returns (uint256, uint256, bytes32)",
  "function protocolFeeBps() view returns (uint256)",
  "function minProtocolFee() view returns (uint256)",
  "function treasury() view returns (address)",
] as const;

export const USDC_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
] as const;

// Viem-compatible ABI for frontend useReadContract / useWriteContract
export const POOL_ABI_VIEM = [
  {
    name: "transact",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "args",
        type: "tuple",
        components: [
          { name: "pA", type: "uint256[2]" },
          { name: "pB", type: "uint256[2][2]" },
          { name: "pC", type: "uint256[2]" },
          { name: "root", type: "bytes32" },
          { name: "publicAmount", type: "int256" },
          { name: "extDataHash", type: "bytes32" },
          { name: "protocolFee", type: "uint256" },
          { name: "inputNullifiers", type: "bytes32[]" },
          { name: "outputCommitments", type: "bytes32[]" },
          { name: "viewTags", type: "uint8[]" },
        ],
      },
      {
        name: "extData",
        type: "tuple",
        components: [
          { name: "recipient", type: "address" },
          { name: "relayer", type: "address" },
          { name: "fee", type: "uint256" },
          { name: "encryptedOutput1", type: "bytes" },
          { name: "encryptedOutput2", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: "getLastRoot",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "nextLeafIndex",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getBalance",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "protocolFeeBps",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "minProtocolFee",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "treasury",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

export const USDC_ABI_VIEM = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
] as const;
