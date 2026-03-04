# PrivAgent + Virtuals Agent Integration

Add private USDC payments to your Virtuals Protocol agent.

## Setup

```bash
npm install privagent-sdk ethers
```

## Usage

```typescript
import { ShieldedWallet, initPoseidon } from 'privagent-sdk';
import { createPrivAgentFetchV4 } from 'privagent-sdk/x402';
import { JsonRpcProvider, Wallet } from 'ethers';
import { randomBytes } from 'crypto';

// Initialize
await initPoseidon();
const provider = new JsonRpcProvider(process.env.BASE_SEPOLIA_RPC);
const signer = new Wallet(process.env.PRIVATE_KEY!, provider);

// Create shielded wallet
const wallet = new ShieldedWallet({
  provider,
  signer,
  poolAddress: '0x8F1ae8209156C22dFD972352A415880040fB0b0c',
  usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  circuitDir: './circuits/build',
  deployBlock: 38347380,
});
await wallet.initialize();

// ECDH keypair for note encryption
const ecdhPrivateKey = randomBytes(32);
const ecdhPublicKey = secp256k1.getPublicKey(ecdhPrivateKey, true);

// Deposit USDC into shielded pool
await wallet.deposit(100_000000n); // 100 USDC

// Create x402-aware fetch (auto-handles 402 + ZK proof)
const privFetch = createPrivAgentFetchV4(wallet, ecdhPrivateKey, ecdhPublicKey);
const response = await privFetch('https://api.example.com/data');
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
