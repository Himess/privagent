#!/bin/bash
set -e

cd "$(dirname "$0")/.."

echo "=== PrivAgent V4 Circuit Build ==="

BUILD_DIR=build/v4
PTAU=powersOfTau28_hez_final_17.ptau
CONFIGS="1x2 2x2"

# Create build directories
for config in $CONFIGS; do
  mkdir -p $BUILD_DIR/$config
done

# Download Powers of Tau (2^17) if not present
if [ ! -f "$PTAU" ]; then
  echo "Downloading Powers of Tau (2^17)..."
  curl -L -o "$PTAU" "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_17.ptau"
fi

# Verify PTAU integrity
EXPECTED_HASH="ab77a8bfbf8cc0a5a24a04ddee47ea0dc62be4f64dae4ebdfce00f015b3a3281"
echo "Verifying PTAU hash..."
ACTUAL_HASH=$(sha256sum "$PTAU" | cut -d' ' -f1)
if [ "$ACTUAL_HASH" != "$EXPECTED_HASH" ]; then
  echo "ERROR: PTAU hash mismatch!"
  echo "  Expected: $EXPECTED_HASH"
  echo "  Actual:   $ACTUAL_HASH"
  exit 1
fi
echo "  PTAU hash verified."

# Install circomlib if needed
if [ ! -d "node_modules/circomlib" ]; then
  echo "Installing circomlib..."
  npm install
fi

# Build each circuit configuration
for config in $CONFIGS; do
  CIRCUIT_NAME="joinSplit_${config}"
  CIRCUIT_FILE="generated/${CIRCUIT_NAME}.circom"
  OUT_DIR="$BUILD_DIR/$config"

  echo ""
  echo "--- Building $CIRCUIT_NAME ---"

  # Compile
  echo "  Compiling..."
  circom $CIRCUIT_FILE --r1cs --wasm --sym -o $OUT_DIR

  # Print constraints
  echo "  Constraints: $(snarkjs r1cs info $OUT_DIR/$CIRCUIT_NAME.r1cs 2>&1 | grep -i 'constraint' | head -1)"

  # Groth16 Phase 2 setup
  echo "  Running Groth16 setup..."
  snarkjs groth16 setup $OUT_DIR/$CIRCUIT_NAME.r1cs $PTAU $OUT_DIR/${CIRCUIT_NAME}_0000.zkey

  # Contribute
  echo "  Contributing to Phase 2..."
  echo "privagent-v4-dev-entropy-${config}" | snarkjs zkey contribute \
    $OUT_DIR/${CIRCUIT_NAME}_0000.zkey \
    $OUT_DIR/${CIRCUIT_NAME}_final.zkey \
    --name="PrivAgent V4 Dev" -v

  # Export verification key
  echo "  Exporting verification key..."
  snarkjs zkey export verificationkey \
    $OUT_DIR/${CIRCUIT_NAME}_final.zkey \
    $OUT_DIR/verification_key.json

  # Export Solidity verifier
  echo "  Exporting Solidity verifier..."
  snarkjs zkey export solidityverifier \
    $OUT_DIR/${CIRCUIT_NAME}_final.zkey \
    $OUT_DIR/Groth16Verifier_${config}.sol

  # Verify zkey
  echo "  Verifying zkey..."
  snarkjs zkey verify \
    $OUT_DIR/$CIRCUIT_NAME.r1cs \
    $PTAU \
    $OUT_DIR/${CIRCUIT_NAME}_final.zkey

  # Copy verifier to contracts
  mkdir -p ../contracts/src/verifiers
  cp $OUT_DIR/Groth16Verifier_${config}.sol ../contracts/src/verifiers/

  echo "  Done: $CIRCUIT_NAME"
done

# Cleanup intermediate zkeys
for config in $CONFIGS; do
  rm -f $BUILD_DIR/$config/joinSplit_${config}_0000.zkey
done

echo ""
echo "=== V4 Build Complete ==="
for config in $CONFIGS; do
  echo "  $config:"
  echo "    WASM:     $BUILD_DIR/$config/joinSplit_${config}_js/joinSplit_${config}.wasm"
  echo "    Zkey:     $BUILD_DIR/$config/joinSplit_${config}_final.zkey"
  echo "    Vkey:     $BUILD_DIR/$config/verification_key.json"
  echo "    Verifier: ../contracts/src/verifiers/Groth16Verifier_${config}.sol"
done
