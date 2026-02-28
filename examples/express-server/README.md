# GhostPay Express Server — Privacy Paywall

Add a privacy-preserving paywall to any Express API endpoint.

## Setup

```bash
npm install ghostpay-sdk ethers express
```

## Usage

```typescript
import express from 'express';
import { ghostPaywallV4 } from 'ghostpay-sdk/x402';
import { JsonRpcProvider, Wallet } from 'ethers';

const app = express();
const signer = new Wallet(process.env.PRIVATE_KEY!, new JsonRpcProvider(process.env.BASE_SEPOLIA_RPC));

// Add privacy paywall to premium endpoints
app.get('/api/premium', ghostPaywallV4({
  price: 1_000000n,  // 1 USDC
  signer,
  poolAddress: '0x17B6209385c2e36E6095b89572273175902547f9',
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
