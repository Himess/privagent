# ERC-8004 + PrivAgent Integration

Integrate PrivAgent private payments with ERC-8004 agent identity.

## Overview

ERC-8004 provides: Agent identity (public) + reputation (public)
PrivAgent provides: Payment privacy (private)

Together: **Verifiable agents, private payments.**

## Quick Start

### 1. Add PrivAgent to your agent registration file

```typescript
import { privAgentPaymentMethod } from 'privagent-sdk/erc8004';

const method = privAgentPaymentMethod({
    poolAddress: '0x8F1ae8209156C22dFD972352A415880040fB0b0c',
    facilitatorUrl: 'https://facilitator.privagent.xyz'
});

// Add to your agent-registration.json paymentMethods array
```

### 2. Accept private payments (server)

```typescript
import { privAgentPaywallV4 } from 'privagent-sdk/x402';

app.use('/api/weather', privAgentPaywallV4({
    poolAddress: '0x8F1ae8209156C22dFD972352A415880040fB0b0c',
    usdcAddress: '0x036C...',
    signer,
    price: '1000000'
}));
```

### 3. Submit feedback with payment proof

```typescript
import { paymentProofForFeedback } from 'privagent-sdk/erc8004';

// After successful private payment, use nullifier as proof
const proof = paymentProofForFeedback(nullifier, poolAddress);
// Submit to ERC-8004 Reputation Registry
```

## Files
- `agent-registration.json` — Example ERC-8004 registration with PrivAgent
