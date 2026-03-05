import { ethers } from "ethers";
async function main() {
  const p = new ethers.JsonRpcProvider("https://sepolia.base.org");
  const usdc = new ethers.Contract(
    "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    ["function balanceOf(address) view returns (uint256)"],
    p
  );
  const w = new ethers.Wallet(process.env.PRIVATE_KEY!);
  console.log("Address:", w.address);
  const [usdcBal, ethBal] = await Promise.all([
    usdc.balanceOf(w.address),
    p.getBalance(w.address),
  ]);
  console.log("USDC:", (Number(usdcBal) / 1e6).toFixed(2));
  console.log("ETH:", ethers.formatEther(ethBal));
}
main();
