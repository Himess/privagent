# PrivAgent + Virtuals Agent Integration

Add private USDC payments to your Virtuals Protocol agent.

## Setup

```bash
npm install privagent-sdk ethers
```

## Usage

```typescript
import { ShieldedWallet, initPoseidon } from 'privagent-sdk';
import { privAgentFetchV4 } from 'privagent-sdk/x402';
import { JsonRpcProvider, Wallet } from 'ethers';

// Initialize
await initPoseidon();
const provider = new JsonRpcProvider(process.env.BASE_SEPOLIA_RPC);
const signer = new Wallet(process.env.PRIVATE_KEY!, provider);

// Create shielded wallet
const wallet = new ShieldedWallet({
  signer,
  poolAddress: '0x8F1ae8209156C22dFD972352A415880040fB0b0c',
  circuitWasmPath: './circuits/joinSplit_1x2.wasm',
  circuitZkeyPath: './circuits/joinSplit_1x2_final.zkey',
  verificationKeyPath: './circuits/verification_key.json',
});

// Deposit USDC into shielded pool
await wallet.deposit(100_000000n); // 100 USDC

// Make private API call (auto-handles 402 + ZK proof)
const response = await privAgentFetchV4('https://api.example.com/data', wallet);
const data = await response.json();
```

## How It Works

1. Agent deposits USDC into ShieldedPoolV4 (on-chain)
2. When calling a paid API, the agent receives a 402 response
3. Agent generates a JoinSplit ZK proof (client-side, ~1.5s)
4. Proof is sent in the `Payment` header
5. Server decrypts the encrypted note to verify payment amount
6. Server calls `transact()` on-chain
7. Agent receives the API response

All amounts, sender, and receiver are hidden on-chain.
