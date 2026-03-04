# PrivAgent Express Server — Privacy Paywall

Add a privacy-preserving paywall to any Express API endpoint.

## Setup

```bash
npm install privagent-sdk ethers express
```

## Usage

```typescript
import express from 'express';
import { privAgentPaywallV4 } from 'privagent-sdk/x402';
import { JsonRpcProvider, Wallet } from 'ethers';

const app = express();
const signer = new Wallet(process.env.PRIVATE_KEY!, new JsonRpcProvider(process.env.BASE_SEPOLIA_RPC));

// Add privacy paywall to premium endpoints
app.get('/api/premium', privAgentPaywallV4({
  price: 1_000000n,  // 1 USDC
  signer,
  poolAddress: '0x8F1ae8209156C22dFD972352A415880040fB0b0c',
}), (req, res) => {
  res.json({ data: 'premium content' });
});

app.listen(3001);
```

## How It Works

1. Client requests `/api/premium`
2. Middleware returns 402 with `zk-exact-v2` payment requirements
3. Client generates JoinSplit ZK proof and retries with `Payment` header
4. Middleware decrypts the encrypted note to verify payment amount
5. Middleware calls `transact()` on-chain
6. Request proceeds to your handler
