// Gera o relatório do experimento (Seção 6.2) a partir de deployments/sepolia-experiment.json
// Uso: node scripts/report-sepolia.js > deployments/sepolia-experiment.md
const st = require("../deployments/sepolia-experiment.json");
const dep = require("../deployments/sepolia.json");

const ES = "https://sepolia.etherscan.io";
const gwei = (s) => Number(s).toFixed(2);
const fmt = (n) => Number(n).toLocaleString("pt-BR");

console.log("# Experimento de governança — Sepolia (Seção 6.2)\n");
console.log(`- Data: ${st.completedAt || "(em andamento)"}`);
console.log(`- CircularDAO (experimento): [\`${st.daoAddress}\`](${ES}/address/${st.daoAddress})`);
console.log(`- GovernanceToken DAOG: [\`${dep.GovernanceToken_DAOG}\`](${ES}/address/${dep.GovernanceToken_DAOG})`);
console.log(`- WasteCategoryRegistry: [\`${dep.WasteCategoryRegistry}\`](${ES}/address/${dep.WasteCategoryRegistry})`);
console.log(`- proposalId: \`${st.proposalId}\``);
console.log(`- Janela de votação: blocos ${st.proposalArgs?.voteStart} → ${st.proposalArgs?.voteEnd} (60 blocos ≈ 12 min)`);
console.log(`- Estado final: ${st.finalState === 7 ? "7 = Executed" : st.finalState}\n`);

console.log("## Transações\n");
console.log("| # | Operação | Signatário | Bloco | Gás | Preço (gwei) | Custo (ETH) | Latência (s) | Tx |");
console.log("|---|----------|-----------|-------|-----|--------------|-------------|--------------|----|");
st.txs.forEach((t, i) => {
  console.log(`| ${i + 1} | ${t.label} | ${t.signer} | ${t.block} | ${fmt(t.gasUsed)} | ${gwei(t.effectiveGasPriceGwei)} | ${Number(t.costEth).toFixed(6)} | ${(t.latencyMs / 1000).toFixed(1)} | [${t.hash.slice(0, 10)}…](${ES}/tx/${t.hash}) |`);
});

const totGas = st.txs.reduce((a, t) => a + BigInt(t.gasUsed), 0n);
const totEth = st.txs.reduce((a, t) => a + Number(t.costEth), 0);
const lats = st.txs.map((t) => t.latencyMs / 1000);
const avg = lats.reduce((a, b) => a + b, 0) / lats.length;
console.log(`\n**Totais:** ${fmt(totGas.toString())} gás | ${totEth.toFixed(6)} ETH | latência média ${avg.toFixed(1)} s (min ${Math.min(...lats).toFixed(1)}, máx ${Math.max(...lats).toFixed(1)})\n`);

console.log("## Custo por operação do ciclo de governança (dados para a Tabela da Seção 6.2)\n");
const ops = ["deploy CircularDAO", "proposeAddCategory", "castVote deployer", "castVote votante2", "castVote votante3", "execute"];
console.log("| Operação | Gás | Custo Sepolia (ETH) |");
console.log("|----------|-----|---------------------|");
for (const t of st.txs) {
  if (ops.some((o) => t.label.startsWith(o))) {
    console.log(`| ${t.label} | ${fmt(t.gasUsed)} | ${Number(t.costEth).toFixed(6)} |`);
  }
}
console.log("\nObs.: custo estimado na Polygon PoS = gás × preço médio de gás da Polygon (~30 gwei) × preço do POL — recalcular na data da submissão.");
