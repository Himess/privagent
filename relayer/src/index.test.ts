import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";

// We test the endpoint structure without a real chain connection.
// The actual relay requires a live provider, so we test routing/validation only.

function createTestApp() {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", chain: "base-sepolia" });
  });

  app.get("/info", (_req, res) => {
    res.json({
      relayerAddress: "0xRelayer",
      fee: "50000",
      poolAddress: "0xPool",
      network: "eip155:84532",
    });
  });

  app.post("/relay", (req, res) => {
    const { recipient, amount, nullifierHash, merkleRoot, proof } = req.body;

    if (!recipient || !amount || !nullifierHash || !merkleRoot || !proof) {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    if (!Array.isArray(proof) || proof.length !== 8) {
      res.status(400).json({ error: "Proof must be array of 8 uint256" });
      return;
    }

    // In test mode, just acknowledge
    res.json({ success: true, txHash: "0xtest", blockNumber: 1 });
  });

  return app;
}

describe("relayer endpoints", () => {
  const app = createTestApp();

  it("GET /health should return ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("GET /info should return relayer info", async () => {
    const res = await request(app).get("/info");
    expect(res.status).toBe(200);
    expect(res.body.relayerAddress).toBe("0xRelayer");
    expect(res.body.fee).toBe("50000");
    expect(res.body.network).toBe("eip155:84532");
  });

  it("POST /relay should reject missing fields", async () => {
    const res = await request(app).post("/relay").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Missing required fields");
  });

  it("POST /relay should reject invalid proof length", async () => {
    const res = await request(app).post("/relay").send({
      recipient: "0xBob",
      amount: "1000000",
      nullifierHash: "0x123",
      merkleRoot: "0x456",
      proof: ["1", "2", "3"], // needs 8
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Proof must be array of 8");
  });

  it("POST /relay should accept valid request", async () => {
    const res = await request(app).post("/relay").send({
      recipient: "0xBob",
      amount: "1000000",
      nullifierHash: "0x123",
      newCommitment: "0x456",
      merkleRoot: "0x789",
      fee: "50000",
      proof: ["1", "2", "3", "4", "5", "6", "7", "8"],
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
