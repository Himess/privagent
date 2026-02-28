# GhostPay Plugin for ElizaOS

Add private payment capabilities to your ElizaOS agent.

## Setup

```bash
npm install ghostpay-sdk ethers
```

## Plugin Registration

```typescript
import { ghostPayPlugin } from './ghostpay-plugin';

// Register in your ElizaOS agent config
const agent = createAgent({
  plugins: [ghostPayPlugin],
  // ... other config
});
```

## Actions

- `PRIVATE_PAY` - Make a private payment to a URL
- `CHECK_BALANCE` - Check shielded USDC balance
- `DEPOSIT` - Deposit USDC into shielded pool

## How It Works

The plugin wraps GhostPay's `ShieldedWallet` and `ghostFetchV4` into ElizaOS
actions. When the agent needs to pay for an API, it uses the `PRIVATE_PAY`
action which generates a JoinSplit ZK proof and sends it in the Payment header.
