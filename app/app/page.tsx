"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useBalance,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { parseUnits, formatUnits, type Address } from "viem";
import {
  POOL_ADDRESS,
  USDC_ADDRESS,
  POOL_ABI_VIEM,
  USDC_ABI_VIEM,
  BLOCKSCOUT_TX,
  BLOCKSCOUT_ADDR,
  CONTRACTS,
} from "@/lib/contracts";

const GITHUB = "https://github.com/Himess/privagent";

// ============ Types ============

interface LogEntry {
  text: string;
  type: "info" | "success" | "error" | "pending";
  timestamp: number;
  link?: string;
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

function formatUSDC(raw: string | bigint): string {
  return formatUnits(BigInt(raw), 6);
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
          {log.link ? (
            <a href={log.link} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {log.text}
            </a>
          ) : (
            log.text
          )}
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

// ============ Wallet Connection ============

function WalletButton() {
  const [mounted, setMounted] = useState(false);
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  const { data: ethBalance } = useBalance({
    address,
    chainId: baseSepolia.id,
  });

  const { data: usdcBalance } = useReadContract({
    address: USDC_ADDRESS as Address,
    abi: USDC_ABI_VIEM,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: baseSepolia.id,
  });

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className="py-2 px-4 text-xs text-privagent-muted">...</div>
    );
  }

  if (!isConnected) {
    return (
      <button
        onClick={() => connect({ connector: connectors[0] })}
        className="bg-privagent-green/10 border border-privagent-green/30 text-privagent-green
                   py-2 px-4 rounded text-xs font-semibold hover:bg-privagent-green/20 transition-colors"
      >
        Connect MetaMask
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <div className="text-right text-xs">
        <div className="text-white font-mono">{truncate(address!, 6)}</div>
        <div className="text-privagent-muted">
          {ethBalance ? `${Number(ethBalance.formatted).toFixed(4)} ETH` : "..."} |{" "}
          {usdcBalance !== undefined ? `${formatUSDC(usdcBalance as bigint)} USDC` : "..."}
        </div>
      </div>
      <button
        onClick={() => disconnect()}
        className="text-privagent-muted hover:text-red-400 text-xs transition-colors"
      >
        Disconnect
      </button>
    </div>
  );
}

// ============ Deposit Panel ============

function DepositPanel({
  logs,
  status,
  onDeposit,
  shieldedBalance,
}: {
  logs: LogEntry[];
  status: "idle" | "running" | "done";
  onDeposit: (amount: string) => void;
  shieldedBalance: string;
}) {
  const [amount, setAmount] = useState("2");

  return (
    <div className="bg-privagent-card border border-privagent-border rounded-lg p-4 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-privagent-green font-bold text-sm uppercase tracking-wider">
          Deposit
        </h2>
        <StatusBadge status={status} />
      </div>

      <div className="mb-3 p-3 bg-privagent-dark rounded border border-privagent-border">
        <div className="text-[10px] text-privagent-muted uppercase mb-1">Shielded Balance</div>
        <div className="text-xl font-bold text-privagent-green font-mono">
          {shieldedBalance} USDC
        </div>
      </div>

      <div className="flex gap-2 mb-3">
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="flex-1 bg-privagent-dark border border-privagent-border rounded px-3 py-2
                     text-xs text-white font-mono focus:border-privagent-green/50 focus:outline-none"
          placeholder="USDC amount"
          min="0.01"
          step="0.01"
        />
        <button
          onClick={() => onDeposit(amount)}
          disabled={status === "running"}
          className="bg-privagent-green/10 border border-privagent-green/30 text-privagent-green
                     py-2 px-4 rounded text-xs font-semibold hover:bg-privagent-green/20
                     transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Deposit
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
        {["Amount", "Sender", "Receiver"].map((label) => (
          <div key={label} className="flex justify-between items-center p-2 bg-privagent-dark rounded border border-privagent-border">
            <span className="text-xs text-privagent-muted">{label}</span>
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
            Generating JoinSplit ZK Proof (server-side)...
          </div>
          <div className="mt-1 h-1 bg-privagent-dark rounded overflow-hidden">
            <motion.div
              className="h-full bg-yellow-400"
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: 3 }}
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
          <div className="text-[10px] text-privagent-muted uppercase mb-1">On-Chain Data (Real)</div>
          {[
            { label: "Nullifier", value: proofData.nullifier },
            { label: "Commitment", value: proofData.commitment },
            { label: "Root", value: proofData.root },
            { label: "Gas Used", value: proofData.gas },
            {
              label: "TX Hash",
              value: proofData.txHash,
              link: `${BLOCKSCOUT_TX}${proofData.txHash}`,
            },
          ].map((item) => (
            <div key={item.label} className="flex justify-between text-[11px] p-1.5 bg-privagent-dark rounded">
              <span className="text-privagent-muted">{item.label}</span>
              {"link" in item && item.link ? (
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-privagent-green hover:underline font-mono"
                >
                  {truncate(item.value, 6)}
                </a>
              ) : (
                <span className="text-privagent-green font-mono">{truncate(item.value, 6)}</span>
              )}
            </div>
          ))}
        </motion.div>
      )}
    </div>
  );
}

// ============ Buy Panel ============

function BuyPanel({
  logs,
  status,
  onBuy,
  earnings,
}: {
  logs: LogEntry[];
  status: "idle" | "running" | "done";
  onBuy: () => void;
  earnings: string;
}) {
  return (
    <div className="bg-privagent-card border border-privagent-border rounded-lg p-4 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-privagent-green font-bold text-sm uppercase tracking-wider">
          Buy Data
        </h2>
        <StatusBadge status={status} />
      </div>

      <div className="mb-3 p-3 bg-privagent-dark rounded border border-privagent-border">
        <div className="text-[10px] text-privagent-muted uppercase mb-1">API Endpoint</div>
        <div className="text-xs font-mono text-white">/api/weather</div>
        <div className="text-[10px] text-privagent-muted mt-1">Price: 1 USDC (private)</div>
      </div>

      <button
        onClick={onBuy}
        disabled={status === "running"}
        className="mb-3 bg-privagent-green/10 border border-privagent-green/30 text-privagent-green
                   py-2 px-4 rounded text-xs font-semibold hover:bg-privagent-green/20
                   transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Buy Weather Data (1 USDC)
      </button>

      <div className="mb-3 p-3 bg-privagent-dark rounded border border-privagent-border">
        <div className="text-[10px] text-privagent-muted uppercase mb-1">Total Earned (Seller)</div>
        <div className="text-xl font-bold text-privagent-green font-mono">{earnings} USDC</div>
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
          { label: "Tree", value: "Poseidon Merkle (depth 20)" },
          { label: "Encryption", value: "ECDH + AES-256-GCM" },
          { label: "Tests", value: "226 passing" },
          { label: "Audits", value: "3 deep (9.0/10)" },
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
              href={`${BLOCKSCOUT_ADDR}${addr}`}
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

// ============ Weather Data Card ============

function WeatherCard({ data }: { data: Record<string, unknown> }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="p-3 bg-privagent-dark rounded border border-privagent-green/30"
    >
      <div className="text-[10px] text-privagent-green uppercase mb-2">Purchased Data</div>
      <div className="grid grid-cols-2 gap-1 text-xs">
        {Object.entries(data).map(([key, val]) => (
          <div key={key}>
            <span className="text-privagent-muted">{key}: </span>
            <span className="text-white">{String(val)}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// ============ Main Page ============

export default function Home() {
  const { address, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();

  // State
  const [depositLogs, setDepositLogs] = useState<LogEntry[]>([]);
  const [buyLogs, setBuyLogs] = useState<LogEntry[]>([]);
  const [depositStatus, setDepositStatus] = useState<"idle" | "running" | "done">("idle");
  const [buyStatus, setBuyStatus] = useState<"idle" | "running" | "done">("idle");
  const [shieldedBalance, setShieldedBalance] = useState("0.00");
  const [earnings, setEarnings] = useState("0.00");
  const [proofData, setProofData] = useState<ProofData | null>(null);
  const [isProving, setIsProving] = useState(false);
  const [weatherData, setWeatherData] = useState<Record<string, unknown> | null>(null);
  const [earnedRaw, setEarnedRaw] = useState(0n);

  const addDepositLog = useCallback(
    (text: string, type: LogEntry["type"] = "info", link?: string) => {
      setDepositLogs((prev) => [...prev, { text, type, timestamp: Date.now(), link }]);
    },
    []
  );

  const addBuyLog = useCallback(
    (text: string, type: LogEntry["type"] = "info", link?: string) => {
      setBuyLogs((prev) => [...prev, { text, type, timestamp: Date.now(), link }]);
    },
    []
  );

  // Fetch shielded balance
  const refreshBalance = useCallback(async () => {
    try {
      const res = await fetch("/api/balance");
      if (res.ok) {
        const data = await res.json();
        setShieldedBalance(formatUSDC(data.shieldedBalance));
      }
    } catch {
      // Silently fail — balance will show stale
    }
  }, []);

  // ============ Deposit Flow ============

  const handleDeposit = useCallback(
    async (amountStr: string) => {
      if (!isConnected || !address) {
        addDepositLog("Connect wallet first", "error");
        return;
      }

      const usdcAmount = parseUnits(amountStr, 6);
      if (usdcAmount <= 0n) {
        addDepositLog("Invalid amount", "error");
        return;
      }

      setDepositStatus("running");
      setIsProving(true);
      addDepositLog(`Generating ZK proof for ${amountStr} USDC deposit...`, "pending");

      try {
        // Step 1: Generate proof via API
        const proofRes = await fetch("/api/deposit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: usdcAmount.toString() }),
        });

        if (!proofRes.ok) {
          const err = await proofRes.json();
          throw new Error(err.error || "Proof generation failed");
        }

        const proofPayload = await proofRes.json();
        setIsProving(false);
        addDepositLog("ZK proof generated (server-side)", "success");

        // Step 2: Approve USDC
        addDepositLog("Approving USDC spend (MetaMask)...", "pending");
        const approveTxHash = await writeContractAsync({
          address: USDC_ADDRESS as Address,
          abi: USDC_ABI_VIEM,
          functionName: "approve",
          args: [POOL_ADDRESS as Address, BigInt(proofPayload.approvalAmount)],
          chainId: baseSepolia.id,
        });
        addDepositLog(
          `USDC approved | TX: ${truncate(approveTxHash)}`,
          "success",
          `${BLOCKSCOUT_TX}${approveTxHash}`
        );

        // Step 3: Call transact via MetaMask
        addDepositLog("Submitting deposit to pool (MetaMask)...", "pending");

        const args = proofPayload.args;
        const ext = proofPayload.extData;

        const depositTxHash = await writeContractAsync({
          address: POOL_ADDRESS as Address,
          abi: POOL_ABI_VIEM,
          functionName: "transact",
          args: [
            {
              pA: [BigInt(args.pA[0]), BigInt(args.pA[1])] as [bigint, bigint],
              pB: [
                [BigInt(args.pB[0][0]), BigInt(args.pB[0][1])],
                [BigInt(args.pB[1][0]), BigInt(args.pB[1][1])],
              ] as [[bigint, bigint], [bigint, bigint]],
              pC: [BigInt(args.pC[0]), BigInt(args.pC[1])] as [bigint, bigint],
              root: args.root as `0x${string}`,
              publicAmount: BigInt(args.publicAmount),
              extDataHash: args.extDataHash as `0x${string}`,
              protocolFee: BigInt(args.protocolFee),
              inputNullifiers: args.inputNullifiers as `0x${string}`[],
              outputCommitments: args.outputCommitments as `0x${string}`[],
              viewTags: args.viewTags,
            },
            {
              recipient: ext.recipient as Address,
              relayer: ext.relayer as Address,
              fee: BigInt(ext.fee),
              encryptedOutput1: ext.encryptedOutput1 as `0x${string}`,
              encryptedOutput2: ext.encryptedOutput2 as `0x${string}`,
            },
          ],
          chainId: baseSepolia.id,
        });

        addDepositLog(
          `Deposited ${amountStr} USDC | TX: ${truncate(depositTxHash)}`,
          "success",
          `${BLOCKSCOUT_TX}${depositTxHash}`
        );

        // Set proof data for center panel
        setProofData({
          nullifier: args.inputNullifiers[0],
          commitment: args.outputCommitments[0],
          root: args.root,
          gas: "~900,000",
          txHash: depositTxHash,
        });

        // Refresh balance
        await refreshBalance();
        setDepositStatus("done");
      } catch (err: unknown) {
        setIsProving(false);
        const message = err instanceof Error ? err.message : "Unknown error";
        addDepositLog(`Error: ${message}`, "error");
        setDepositStatus("idle");
      }
    },
    [isConnected, address, addDepositLog, writeContractAsync, refreshBalance]
  );

  // ============ Buy Flow ============

  const handleBuy = useCallback(async () => {
    setBuyStatus("running");
    setIsProving(true);
    addBuyLog("Requesting weather data (1 USDC)...", "pending");
    addBuyLog("Generating JoinSplit ZK proof (server-side)...", "pending");

    try {
      const res = await fetch("/api/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: "1000000" }),
      });

      setIsProving(false);

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Buy failed");
      }

      const data = await res.json();

      addBuyLog("ZK proof generated + submitted on-chain (relayer)", "success");
      addBuyLog(
        `TX confirmed | TX: ${truncate(data.txHash)}`,
        "success",
        `${BLOCKSCOUT_TX}${data.txHash}`
      );

      // Set proof data
      setProofData({
        nullifier: data.nullifiers[0],
        commitment: data.commitments[0],
        root: data.root,
        gas: "~900,000",
        txHash: data.txHash,
      });

      // Update earnings
      const newEarned = earnedRaw + 1000000n;
      setEarnedRaw(newEarned);
      setEarnings(formatUSDC(newEarned));

      // Set weather data
      setWeatherData(data.weatherData);

      // Show balance
      setShieldedBalance(formatUSDC(data.shieldedBalance));
      addBuyLog(`Shielded balance: ${formatUSDC(data.shieldedBalance)} USDC`, "info");

      setBuyStatus("done");
    } catch (err: unknown) {
      setIsProving(false);
      const message = err instanceof Error ? err.message : "Unknown error";
      addBuyLog(`Error: ${message}`, "error");
      setBuyStatus("idle");
    }
  }, [addBuyLog, earnedRaw]);

  // Load balance on mount
  useEffect(() => {
    refreshBalance();
  }, [refreshBalance]);

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-6"
      >
        <div className="flex justify-between items-start mb-4">
          <div />
          <div>
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
          </div>
          <WalletButton />
        </div>
      </motion.div>

      {/* 3-Panel Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}>
          <DepositPanel
            logs={depositLogs}
            status={depositStatus}
            onDeposit={handleDeposit}
            shieldedBalance={shieldedBalance}
          />
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <PrivacyPanel proofData={proofData} isProving={isProving} />
        </motion.div>

        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}>
          <BuyPanel
            logs={buyLogs}
            status={buyStatus}
            onBuy={handleBuy}
            earnings={earnings}
          />
        </motion.div>
      </div>

      {/* Weather Data (if purchased) */}
      <AnimatePresence>
        {weatherData && (
          <div className="mb-6">
            <WeatherCard data={weatherData} />
          </div>
        )}
      </AnimatePresence>

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
        <p>Live on Base Sepolia | Real ZK proofs + on-chain transactions</p>
        <p>
          <a href={GITHUB} target="_blank" rel="noopener noreferrer" className="hover:text-privagent-green transition-colors">
            github.com/Himess/privagent
          </a>
        </p>
      </div>
    </main>
  );
}
