"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ============ Constants ============

const CONTRACTS = {
  PoseidonHasher: "0x3ae70C9741a9959fA32bC9BC09959d3d319Ee3Cd",
  Verifier_1x2: "0xe473aF953d269601402DEBcB2cc899aB594Ad31e",
  Verifier_2x2: "0x10D5BB24327d40c4717676E3B7351D76deb33848",
  ShieldedPoolV4: "0x17B6209385c2e36E6095b89572273175902547f9",
};

const BLOCKSCOUT = "https://base-sepolia.blockscout.com/address/";
const GITHUB = "https://github.com/Himess/privagent";

// ============ Types ============

interface LogEntry {
  text: string;
  type: "info" | "success" | "error" | "pending";
  timestamp: number;
}

interface ProofData {
  nullifier: string;
  commitment: string;
  root: string;
  gas: string;
  txHash: string;
}

// ============ Helpers ============

function truncate(s: string, n = 8): string {
  if (s.length <= n * 2 + 2) return s;
  return s.slice(0, n + 2) + "..." + s.slice(-n);
}

function randomHex(bytes: number): string {
  const arr = new Array(bytes * 2);
  const hex = "0123456789abcdef";
  for (let i = 0; i < arr.length; i++) arr[i] = hex[Math.floor(Math.random() * 16)];
  return "0x" + arr.join("");
}

async function simulateDelay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ============ Components ============

function LogPanel({ logs }: { logs: LogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs]);

  return (
    <div ref={ref} className="h-48 overflow-y-auto space-y-1 text-xs">
      {logs.map((log, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className={`font-mono ${
            log.type === "success"
              ? "text-privagent-green"
              : log.type === "error"
              ? "text-red-400"
              : log.type === "pending"
              ? "text-yellow-400"
              : "text-privagent-muted"
          }`}
        >
          <span className="text-privagent-muted/50 mr-2">
            {new Date(log.timestamp).toLocaleTimeString()}
          </span>
          {log.type === "pending" && (
            <span className="inline-block animate-spin mr-1">*</span>
          )}
          {log.text}
        </motion.div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: "idle" | "running" | "done" }) {
  const colors = {
    idle: "bg-privagent-muted/20 text-privagent-muted",
    running: "bg-yellow-500/20 text-yellow-400",
    done: "bg-privagent-green/20 text-privagent-green",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-semibold ${colors[status]}`}>
      {status}
    </span>
  );
}

// ============ Buyer Panel ============

function BuyerPanel({
  onDeposit,
  onBuy,
  balance,
  status,
  logs,
}: {
  onDeposit: () => void;
  onBuy: () => void;
  balance: string;
  status: "idle" | "running" | "done";
  logs: LogEntry[];
}) {
  return (
    <div className="bg-privagent-card border border-privagent-border rounded-lg p-4 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-privagent-green font-bold text-sm uppercase tracking-wider">
          Buyer Agent
        </h2>
        <StatusBadge status={status} />
      </div>

      <div className="mb-3 p-3 bg-privagent-dark rounded border border-privagent-border">
        <div className="text-[10px] text-privagent-muted uppercase mb-1">Shielded Balance</div>
        <div className="text-xl font-bold text-privagent-green font-mono">{balance}</div>
      </div>

      <div className="flex gap-2 mb-3">
        <button
          onClick={onDeposit}
          disabled={status === "running"}
          className="flex-1 bg-privagent-green/10 border border-privagent-green/30 text-privagent-green
                     py-2 px-3 rounded text-xs font-semibold hover:bg-privagent-green/20
                     transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Deposit USDC
        </button>
        <button
          onClick={onBuy}
          disabled={status === "running"}
          className="flex-1 bg-privagent-green/10 border border-privagent-green/30 text-privagent-green
                     py-2 px-3 rounded text-xs font-semibold hover:bg-privagent-green/20
                     transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Buy Data
        </button>
      </div>

      <div className="text-[10px] text-privagent-muted uppercase mb-1">Transaction Log</div>
      <LogPanel logs={logs} />
    </div>
  );
}

// ============ Privacy Panel ============

function PrivacyPanel({
  proofData,
  isProving,
}: {
  proofData: ProofData | null;
  isProving: boolean;
}) {
  return (
    <div className="bg-privagent-card border border-privagent-border rounded-lg p-4 flex flex-col">
      <h2 className="text-privagent-green font-bold text-sm uppercase tracking-wider mb-3">
        Privacy Proof
      </h2>

      <div className="space-y-2 mb-4">
        {[
          { label: "Amount", hidden: true },
          { label: "Sender", hidden: true },
          { label: "Receiver", hidden: true },
        ].map((item) => (
          <div key={item.label} className="flex justify-between items-center p-2 bg-privagent-dark rounded border border-privagent-border">
            <span className="text-xs text-privagent-muted">{item.label}</span>
            <span className="pulse-hidden text-xs font-bold">HIDDEN</span>
          </div>
        ))}
      </div>

      {isProving && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mb-3 p-3 bg-yellow-500/5 border border-yellow-500/20 rounded"
        >
          <div className="flex items-center gap-2 text-yellow-400 text-xs">
            <span className="animate-spin">*</span>
            Generating JoinSplit ZK Proof...
          </div>
          <div className="mt-1 h-1 bg-privagent-dark rounded overflow-hidden">
            <motion.div
              className="h-full bg-yellow-400"
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: 1.5 }}
            />
          </div>
        </motion.div>
      )}

      {proofData && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-2"
        >
          <div className="text-[10px] text-privagent-muted uppercase mb-1">On-Chain Data</div>
          {[
            { label: "Nullifier", value: proofData.nullifier },
            { label: "Commitment", value: proofData.commitment },
            { label: "Root", value: proofData.root },
            { label: "Gas Used", value: proofData.gas },
            { label: "TX Hash", value: proofData.txHash },
          ].map((item) => (
            <div key={item.label} className="flex justify-between text-[11px] p-1.5 bg-privagent-dark rounded">
              <span className="text-privagent-muted">{item.label}</span>
              <span className="text-privagent-green font-mono">{truncate(item.value, 6)}</span>
            </div>
          ))}
        </motion.div>
      )}
    </div>
  );
}

// ============ Seller Panel ============

function SellerPanel({
  earnings,
  status,
  logs,
}: {
  earnings: string;
  status: "idle" | "running" | "done";
  logs: LogEntry[];
}) {
  return (
    <div className="bg-privagent-card border border-privagent-border rounded-lg p-4 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-privagent-green font-bold text-sm uppercase tracking-wider">
          Seller Agent
        </h2>
        <StatusBadge status={status} />
      </div>

      <div className="mb-3 p-3 bg-privagent-dark rounded border border-privagent-border">
        <div className="text-[10px] text-privagent-muted uppercase mb-1">API Endpoint</div>
        <div className="text-xs font-mono text-white">/api/weather</div>
        <div className="text-[10px] text-privagent-muted mt-1">Price: 1 USDC</div>
      </div>

      <div className="mb-3 p-3 bg-privagent-dark rounded border border-privagent-border">
        <div className="text-[10px] text-privagent-muted uppercase mb-1">Total Earned</div>
        <div className="text-xl font-bold text-privagent-green font-mono">{earnings}</div>
      </div>

      <div className="text-[10px] text-privagent-muted uppercase mb-1">Request Log</div>
      <LogPanel logs={logs} />
    </div>
  );
}

// ============ Comparison Table ============

function ComparisonTable() {
  const rows = [
    { feature: "Amount visible", normal: true, privagent: false },
    { feature: "Sender visible", normal: true, privagent: false },
    { feature: "Receiver visible", normal: true, privagent: false },
    { feature: "Proof time", normal: "N/A", privagent: "~1.5s" },
    { feature: "Extra gas cost", normal: "$0", privagent: "~$0.02" },
    { feature: "Compliance ready", normal: "N/A", privagent: "POI planned" },
  ];

  return (
    <div className="bg-privagent-card border border-privagent-border rounded-lg p-4">
      <h2 className="text-privagent-green font-bold text-sm uppercase tracking-wider mb-3">
        Privacy Comparison
      </h2>

      <div className="mb-3 p-3 bg-privagent-dark rounded border border-privagent-border space-y-1">
        <div className="text-xs">
          <span className="text-privagent-muted">Normal x402: </span>
          <span className="text-white">Alice pays 1 USDC to Bob</span>
          <span className="text-red-400 ml-2">EVERYONE SEES</span>
        </div>
        <div className="text-xs">
          <span className="text-privagent-muted">PrivAgent: </span>
          <span className="text-privagent-green">??? pays ??? to ???</span>
          <span className="text-privagent-green ml-2">NOBODY SEES</span>
        </div>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="text-privagent-muted border-b border-privagent-border">
            <th className="text-left py-2 font-normal">Feature</th>
            <th className="text-center py-2 font-normal">Normal</th>
            <th className="text-center py-2 font-normal">PrivAgent</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.feature} className="border-b border-privagent-border/50">
              <td className="py-2 text-privagent-muted">{row.feature}</td>
              <td className="py-2 text-center">
                {typeof row.normal === "boolean" ? (
                  row.normal ? (
                    <span className="text-red-400">Visible</span>
                  ) : (
                    <span className="text-privagent-green">Hidden</span>
                  )
                ) : (
                  <span className="text-privagent-muted">{row.normal}</span>
                )}
              </td>
              <td className="py-2 text-center">
                {typeof row.privagent === "boolean" ? (
                  row.privagent ? (
                    <span className="text-red-400">Visible</span>
                  ) : (
                    <span className="text-privagent-green">Hidden</span>
                  )
                ) : (
                  <span className="text-privagent-green">{row.privagent}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============ Tech Stack ============

function TechStack() {
  return (
    <div className="bg-privagent-card border border-privagent-border rounded-lg p-4">
      <h2 className="text-privagent-green font-bold text-sm uppercase tracking-wider mb-3">
        Technical Stack
      </h2>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {[
          { label: "Circuit", value: "Circom + Groth16" },
          { label: "Contract", value: "ShieldedPoolV4 (Foundry)" },
          { label: "SDK", value: "TypeScript ESM" },
          { label: "Network", value: "Base Sepolia" },
          { label: "Tree", value: "Poseidon Merkle (depth 16)" },
          { label: "Encryption", value: "ECDH + AES-256-GCM" },
          { label: "Tests", value: "237+ passing" },
          { label: "Audits", value: "2 complete" },
        ].map((item) => (
          <div key={item.label} className="p-2 bg-privagent-dark rounded border border-privagent-border">
            <div className="text-[10px] text-privagent-muted uppercase">{item.label}</div>
            <div className="text-white font-mono">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============ Contract Links ============

function ContractLinks() {
  return (
    <div className="bg-privagent-card border border-privagent-border rounded-lg p-4">
      <h2 className="text-privagent-green font-bold text-sm uppercase tracking-wider mb-3">
        Deployed Contracts (Base Sepolia)
      </h2>
      <div className="space-y-1.5">
        {Object.entries(CONTRACTS).map(([name, addr]) => (
          <div key={name} className="flex justify-between items-center text-xs p-1.5 bg-privagent-dark rounded">
            <span className="text-privagent-muted">{name}</span>
            <a
              href={`${BLOCKSCOUT}${addr}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-privagent-green hover:underline font-mono"
            >
              {truncate(addr)}
            </a>
          </div>
        ))}
      </div>
      <div className="mt-3 text-center">
        <a
          href={GITHUB}
          target="_blank"
          rel="noopener noreferrer"
          className="text-privagent-green text-xs hover:underline"
        >
          github.com/Himess/privagent
        </a>
      </div>
    </div>
  );
}

// ============ Main Page ============

export default function Home() {
  const [buyerLogs, setBuyerLogs] = useState<LogEntry[]>([]);
  const [sellerLogs, setSellerLogs] = useState<LogEntry[]>([]);
  const [buyerStatus, setBuyerStatus] = useState<"idle" | "running" | "done">("idle");
  const [sellerStatus, setSellerStatus] = useState<"idle" | "running" | "done">("idle");
  const [balance, setBalance] = useState("0.00 USDC");
  const [earnings, setEarnings] = useState("0.00 USDC");
  const [proofData, setProofData] = useState<ProofData | null>(null);
  const [isProving, setIsProving] = useState(false);
  const [depositCount, setDepositCount] = useState(0);
  const [earnedAmount, setEarnedAmount] = useState(0);

  const addBuyerLog = useCallback((text: string, type: LogEntry["type"] = "info") => {
    setBuyerLogs((prev) => [...prev, { text, type, timestamp: Date.now() }]);
  }, []);

  const addSellerLog = useCallback((text: string, type: LogEntry["type"] = "info") => {
    setSellerLogs((prev) => [...prev, { text, type, timestamp: Date.now() }]);
  }, []);

  const handleDeposit = useCallback(async () => {
    setBuyerStatus("running");
    addBuyerLog("Initiating USDC deposit...", "pending");
    await simulateDelay(800);

    const txHash = randomHex(32);
    addBuyerLog(`Approving USDC spend...`, "pending");
    await simulateDelay(600);

    addBuyerLog(`Calling transact() with publicAmount=2000000`, "pending");
    await simulateDelay(1200);

    const newCount = depositCount + 2;
    setDepositCount(newCount);
    setBalance(`${newCount.toFixed(2)} USDC`);

    addBuyerLog(`Deposited 2.00 USDC | TX: ${truncate(txHash)}`, "success");
    addBuyerLog(`2 output commitments inserted into Merkle tree`, "success");
    addBuyerLog(`New shielded balance: ${newCount.toFixed(2)} USDC`, "info");
    setBuyerStatus("done");
  }, [addBuyerLog, depositCount]);

  const handleBuy = useCallback(async () => {
    if (depositCount < 1) {
      addBuyerLog("Insufficient balance. Deposit first.", "error");
      return;
    }

    setBuyerStatus("running");
    setSellerStatus("running");

    // Step 1: Request
    addBuyerLog("GET /api/weather", "info");
    await simulateDelay(400);

    // Step 2: 402
    addSellerLog("Incoming request from agent", "info");
    addSellerLog("No Payment header -> 402 Payment Required", "info");
    addBuyerLog("Received 402 Payment Required", "pending");
    addBuyerLog('Scheme: "zk-exact-v2" | Amount: 1.00 USDC', "info");
    await simulateDelay(300);

    // Step 3: Proof generation
    addBuyerLog("Selecting UTXO (coin selection: exact match)...", "pending");
    await simulateDelay(200);
    setIsProving(true);
    addBuyerLog("Generating JoinSplit ZK proof (1x2)...", "pending");
    await simulateDelay(1500);
    setIsProving(false);

    const nullifier = randomHex(32);
    const commitment = randomHex(32);
    const root = randomHex(32);
    const txHash = randomHex(32);

    addBuyerLog("Proof generated (1.4s) | Encrypting output notes (ECDH)", "success");
    await simulateDelay(200);

    // Step 4: Payment header
    addBuyerLog("Retrying with Payment header (base64)", "pending");
    await simulateDelay(300);

    // Step 5: Server side
    addSellerLog("Payment header received (V4 payload)", "info");
    addSellerLog("Decrypting note with ECDH shared secret...", "pending");
    await simulateDelay(400);
    addSellerLog("Amount verified: 1.00 USDC (off-chain)", "success");
    addSellerLog("Submitting transact() on-chain...", "pending");
    await simulateDelay(1000);
    addSellerLog(`TX confirmed | Gas: 892,431 | ${truncate(txHash)}`, "success");

    // Step 6: Set proof data
    setProofData({ nullifier, commitment, root, gas: "892,431", txHash });

    // Step 7: Response
    const newCount = depositCount - 1;
    const newEarned = earnedAmount + 1;
    setDepositCount(newCount);
    setEarnedAmount(newEarned);
    setBalance(`${newCount.toFixed(2)} USDC`);
    setEarnings(`${newEarned.toFixed(2)} USDC`);

    addSellerLog("Serving weather data to agent", "success");
    addBuyerLog("200 OK | Weather data received", "success");
    addBuyerLog(`Remaining shielded balance: ${newCount.toFixed(2)} USDC`, "info");
    addSellerLog(`Total earned: ${newEarned.toFixed(2)} USDC`, "info");

    setBuyerStatus("done");
    setSellerStatus("done");
  }, [addBuyerLog, addSellerLog, depositCount, earnedAmount]);

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8"
      >
        <h1 className="text-3xl md:text-4xl font-bold mb-2">
          <span className="text-privagent-green">PrivAgent</span>
          <span className="text-white">Pay</span>
          <span className="text-privagent-muted text-lg ml-2">V4</span>
        </h1>
        <p className="text-privagent-muted text-sm">
          Private AI Agent Payments on Base
        </p>
        <p className="text-privagent-muted/50 text-xs mt-1">
          UTXO JoinSplit | Groth16 ZK Proofs | x402 HTTP Protocol
        </p>
      </motion.div>

      {/* 3-Panel Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}>
          <BuyerPanel
            onDeposit={handleDeposit}
            onBuy={handleBuy}
            balance={balance}
            status={buyerStatus}
            logs={buyerLogs}
          />
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <PrivacyPanel proofData={proofData} isProving={isProving} />
        </motion.div>

        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}>
          <SellerPanel earnings={earnings} status={sellerStatus} logs={sellerLogs} />
        </motion.div>
      </div>

      {/* Bottom Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <ComparisonTable />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
          <TechStack />
        </motion.div>
      </div>

      {/* Contract Links */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
        <ContractLinks />
      </motion.div>

      {/* Footer */}
      <div className="text-center mt-8 text-privagent-muted/40 text-xs space-y-1">
        <p>Built for Base Batch | Simulation mode (no real transactions)</p>
        <p>
          <a href={GITHUB} target="_blank" rel="noopener noreferrer" className="hover:text-privagent-green transition-colors">
            github.com/Himess/privagent
          </a>
        </p>
      </div>
    </main>
  );
}
