#!/bin/bash
#
# PrivAgent Demo — runs seller + buyer agents
#
# Usage:
#   PRIVATE_KEY_SELLER=0x... PRIVATE_KEY_BUYER=0x... ./demo/run-demo.sh
#

set -e

if [ -z "$PRIVATE_KEY_SELLER" ]; then
  echo "Error: PRIVATE_KEY_SELLER env var not set"
  echo "Usage: PRIVATE_KEY_SELLER=0x... PRIVATE_KEY_BUYER=0x... ./demo/run-demo.sh"
  exit 1
fi

if [ -z "$PRIVATE_KEY_BUYER" ]; then
  echo "Error: PRIVATE_KEY_BUYER env var not set"
  echo "Usage: PRIVATE_KEY_SELLER=0x... PRIVATE_KEY_BUYER=0x... ./demo/run-demo.sh"
  exit 1
fi

echo "=== PrivAgent Demo ==="
echo ""

# Start seller in background
echo "Starting seller agent..."
PRIVATE_KEY="$PRIVATE_KEY_SELLER" npx tsx demo/agent-seller-v4.ts &
SELLER_PID=$!

# Wait for seller to start
sleep 4

echo ""
echo "Starting buyer agent..."
PRIVATE_KEY="$PRIVATE_KEY_BUYER" npx tsx demo/agent-buyer-v4.ts

# Cleanup
echo ""
echo "Stopping seller..."
kill $SELLER_PID 2>/dev/null || true
wait $SELLER_PID 2>/dev/null || true

echo "Done."
