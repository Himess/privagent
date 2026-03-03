#!/bin/bash
set -e

CIRCUIT=privatePayment
BUILD_DIR=build
PTAU=powersOfTau28_hez_final_15.ptau

cd "$(dirname "$0")/.."

echo "=== PrivAgent Circuit Build ==="

# Create build directory
mkdir -p $BUILD_DIR

# Download Powers of Tau if not present
if [ ! -f "$PTAU" ]; then
  echo "Downloading Powers of Tau (2^15)..."
  curl -L -o "$PTAU" "https://storage.googleapis.com/zkevm/ptau/$PTAU"
fi

# Install circomlib if needed
if [ ! -d "node_modules/circomlib" ]; then
  echo "Installing circomlib..."
  npm install
fi

# Compile circuit
echo "Compiling circuit..."
circom $CIRCUIT.circom --r1cs --wasm --sym -o $BUILD_DIR

echo "Circuit constraints: $(snarkjs r1cs info $BUILD_DIR/$CIRCUIT.r1cs 2>&1 | grep 'Constraints' | awk '{print $NF}')"

# Groth16 Phase 2 setup
echo "Running Groth16 setup..."
snarkjs groth16 setup $BUILD_DIR/$CIRCUIT.r1cs $PTAU $BUILD_DIR/${CIRCUIT}_0000.zkey

# Contribute to Phase 2 (single entropy for dev)
echo "Contributing to Phase 2..."
echo "privagent-dev-entropy" | snarkjs zkey contribute $BUILD_DIR/${CIRCUIT}_0000.zkey $BUILD_DIR/${CIRCUIT}_final.zkey --name="PrivAgent Dev" -v

# Export verification key
echo "Exporting verification key..."
snarkjs zkey export verificationkey $BUILD_DIR/${CIRCUIT}_final.zkey $BUILD_DIR/verification_key.json

# Export Solidity verifier
echo "Exporting Solidity verifier..."
snarkjs zkey export solidityverifier $BUILD_DIR/${CIRCUIT}_final.zkey $BUILD_DIR/Groth16Verifier.sol

# Copy verifier to contracts
cp $BUILD_DIR/Groth16Verifier.sol ../contracts/src/Groth16Verifier.sol

echo "=== Build complete ==="
echo "  WASM:     $BUILD_DIR/${CIRCUIT}_js/${CIRCUIT}.wasm"
echo "  Zkey:     $BUILD_DIR/${CIRCUIT}_final.zkey"
echo "  Vkey:     $BUILD_DIR/verification_key.json"
echo "  Verifier: ../contracts/src/Groth16Verifier.sol"
