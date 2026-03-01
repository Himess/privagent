# ERC-8004 + GhostPay Integration

Integrate GhostPay private payments with ERC-8004 agent identity.

## Overview

ERC-8004 provides: Agent identity (public) + reputation (public)
GhostPay provides: Payment privacy (private)

Together: **Verifiable agents, private payments.**

## Quick Start

### 1. Add GhostPay to your agent registration file

```typescript
import { ghostPayPaymentMethod } from 'ghostpay-sdk/erc8004';

const method = ghostPayPaymentMethod({
    poolAddress: '0x17B6209385c2e36E6095b89572273175902547f9',
    facilitatorUrl: 'https://facilitator.ghostpay.xyz'
});

// Add to your agent-registration.json paymentMethods array
```

### 2. Accept private payments (server)

```typescript
import { ghostPaywallV4 } from 'ghostpay-sdk/x402';

app.use('/api/weather', ghostPaywallV4({
    poolAddress: '0x17B6...',
    usdcAddress: '0x036C...',
    signer,
    price: '1000000'
}));
```

### 3. Submit feedback with payment proof

```typescript
import { paymentProofForFeedback } from 'ghostpay-sdk/erc8004';

// After successful private payment, use nullifier as proof
const proof = paymentProofForFeedback(nullifier, poolAddress);
// Submit to ERC-8004 Reputation Registry
```

## Files
- `agent-registration.json` — Example ERC-8004 registration with GhostPay
