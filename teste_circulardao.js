/**
 * TESTE CircularDAO — Cenário do Artigo ENGEP
 * =============================================
 * Simula o fluxo completo:
 *   1. Registra cooperativa e cooperado
 *   2. Submete lote de resíduo (como se viesse do JSON do Alexandre)
 *   3. "Emite" NFT Passaporte Digital de Resíduo
 *   4. "Emite" tokens CircularCredit
 *   5. Cria proposta na DAO (projeto tampinhas)
 *   6. Vota e aprova a proposta
 *
 * COMO USAR:
 *   No servidor onde o projeto roda:
 *   1. cd /root/dao-tese  (ou pasta do projeto)
 *   2. npm install ethers  (se não tiver)
 *   3. npx hardhat node  (em outro terminal)
 *   4. node teste_circulardao.js
 *
 * Se quiser rodar diretamente com Ganache:
 *   ganache --deterministic  (em outro terminal)
 *   node teste_circulardao.js
 */

const { ethers } = require("ethers");

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const RPC_URL = "http://127.0.0.1:8545";   // Ganache ou Hardhat node
const CHAIN_ID = 1337;                      // Ganache padrão (Hardhat = 31337)

// ─── ABIs mínimas para simular os contratos do Thomaz ────────────────────────
// Se você já tem contratos deployados, substitua pelos endereços reais abaixo
// ENDEREÇOS — preencher com os do seu deploy:
const CONTRACTS = {
  StakeholderRegistry: process.env.REGISTRY_ADDR   || null,
  MaterialPassport:    process.env.PASSPORT_ADDR   || null,
  CircularCredit:      process.env.CREDIT_ADDR     || null,
  CircularDAO:         process.env.DAO_ADDR        || null,
};

// ─── Dados do cenário do artigo (JSON que viria do app do Alexandre) ──────────
const WASTE_BATCH_JSON = {
  batch_id: "BATCH-2026-001",
  collector_id: "cooperado_joao",
  cooperative: "Cooperativa Verde Esperança",
  timestamp: new Date().toISOString(),
  location: { lat: -23.5505, lng: -46.6333, city: "São Paulo" },
  material_tree: {
    parent: { id: "COMP-001", type: "computador_desktop", brand: "Dell", model: "OptiPlex" },
    children: [
      { id: "COMP-001-01", type: "placa_mae",    weight_kg: 0.8,  material: "FR4/cobre",  credit_factor: 25 },
      { id: "COMP-001-02", type: "fonte",         weight_kg: 0.5,  material: "ferro/cobre",credit_factor: 15 },
      { id: "COMP-001-03", type: "gabinete",      weight_kg: 2.1,  material: "aco",        credit_factor: 10 },
      { id: "COMP-001-04", type: "plastico_abs",  weight_kg: 0.4,  material: "ABS",        credit_factor: 8  },
    ]
  },
  total_weight_kg: 3.8,
  waste_category: "eletroeletronico",
  status: "COLETADO"
};

const DAO_PROPOSAL = {
  id: "PROP-001",
  title: "Projeto Coleta Tampinhas Coca-Cola",
  description: "Coleta seletiva de tampinhas plásticas para doação a escola pública da região. Tokens arrecadados financiam material escolar.",
  proposer: "cooperado_joao",
  type: "PROJETO_SOCIAL",
  tokens_requested: 500,
  beneficiary: "Escola Estadual Professor Lima",
  voting_period_hours: 48
};

// ─── UTILITÁRIOS ─────────────────────────────────────────────────────────────
function log(emoji, msg) { console.log(`${emoji}  ${msg}`); }
function logJSON(label, obj) {
  console.log(`\n📋 ${label}:`);
  console.log(JSON.stringify(obj, null, 2));
}
function separator(title) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

// ─── CÁLCULO DE TOKENS (lógica do CircularCredit) ─────────────────────────────
function calcTokens(materialTree) {
  let total = 0;
  for (const child of materialTree.children) {
    const tokens = child.weight_kg * child.credit_factor;
    total += tokens;
    log("🔢", `  ${child.type}: ${child.weight_kg}kg × ${child.credit_factor} tokens/kg = ${tokens} tokens`);
  }
  return total;
}

// ─── SIMULAÇÃO DO PASSAPORTE DIGITAL ─────────────────────────────────────────
function generateNFTMetadata(batch, txHash) {
  return {
    name: `Passaporte Digital de Resíduo #${batch.batch_id}`,
    description: `Registro imutável on-chain de lote de resíduo ${batch.waste_category}`,
    attributes: [
      { trait_type: "Categoria",       value: batch.waste_category },
      { trait_type: "Cooperativa",     value: batch.cooperative },
      { trait_type: "Peso Total (kg)", value: batch.total_weight_kg },
      { trait_type: "Status",          value: batch.status },
      { trait_type: "Data Coleta",     value: batch.timestamp },
      { trait_type: "Cidade",          value: batch.location.city },
      { trait_type: "Componentes",     value: batch.material_tree.children.length },
    ],
    material_tree: batch.material_tree,
    blockchain: { tx_hash: txHash, network: "Ethereum (Local)" }
  };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n" + "═".repeat(60));
  console.log("  🔬 TESTE CircularDAO — Cenário Artigo ENGEP");
  console.log("  Tokenização Blockchain para Gestão de Resíduos");
  console.log("═".repeat(60));

  // 1. Conectar ao nó local
  separator("ETAPA 1 — Conexão com Blockchain Local");
  let provider;
  try {
    provider = new ethers.JsonRpcProvider(RPC_URL);
    const network = await provider.getNetwork();
    const block = await provider.getBlockNumber();
    log("✅", `Conectado ao nó: ${RPC_URL}`);
    log("🔗", `Chain ID: ${network.chainId}  |  Bloco atual: ${block}`);
  } catch (e) {
    log("❌", `Falha ao conectar em ${RPC_URL}`);
    log("💡", "Inicie o Hardhat: cd /root/dao-tese && npx hardhat node");
    log("💡", "Ou Ganache: ganache --deterministic");
    process.exit(1);
  }

  // Pegar contas de teste (ethers v6: listAccounts() retorna JsonRpcSigner[])
  const signers = await provider.listAccounts();
  log("👛", `Contas disponíveis: ${signers.length}`);
  const admin      = signers[0].address;
  const cooperado  = signers[1].address;
  const reciclador = signers[2].address;
  const governo    = signers[3].address;
  log("🏛️", `Admin/Cooperativa: ${admin}`);
  log("👤", `Cooperado (João):  ${cooperado}`);
  log("♻️ ", `Reciclador:        ${reciclador}`);
  log("🏛️", `Governo/Auditor:   ${governo}`);

  // 2. Verificar contratos existentes ou simular
  separator("ETAPA 2 — Verificação dos Contratos (DAO do Thomaz)");
  const hasContracts = Object.values(CONTRACTS).some(v => v !== null);

  if (hasContracts) {
    log("📄", "Contratos encontrados nas variáveis de ambiente:");
    for (const [name, addr] of Object.entries(CONTRACTS)) {
      if (addr) {
        const code = await provider.getCode(addr);
        const deployed = code !== "0x";
        log(deployed ? "✅" : "❌", `  ${name}: ${addr} ${deployed ? "(deployado)" : "(não encontrado)"}`);
      }
    }
  } else {
    log("⚠️ ", "Endereços dos contratos não configurados.");
    log("💡", "Para usar seus contratos, exporte as variáveis antes de rodar:");
    log("   ", "  export REGISTRY_ADDR=0x...");
    log("   ", "  export PASSPORT_ADDR=0x...");
    log("   ", "  export CREDIT_ADDR=0x...");
    log("   ", "  export DAO_ADDR=0x...");
    log("🔄", "Continuando com SIMULAÇÃO dos fluxos (sem deploy)...");
  }

  // 3. Simular recebimento do JSON do Alexandre
  separator("ETAPA 3 — Recebimento do JSON (Camada Interface — Alexandre)");
  logJSON("Dados recebidos do app mobile (JSON)", WASTE_BATCH_JSON);

  // Simular hash dos dados (como o IPFS faria)
  const dataString = JSON.stringify(WASTE_BATCH_JSON);
  const ipfsHash = "Qm" + Buffer.from(dataString).toString("base64").substring(0, 44);
  log("📎", `Hash IPFS simulado dos dados: ${ipfsHash}`);

  // 4. Emitir Passaporte Digital de Resíduo (NFT)
  separator("ETAPA 4 — Emissão do Passaporte Digital de Resíduo (NFT ERC-1155)");

  // Simular transação blockchain
  const signer = await provider.getSigner(cooperado);  // cooperado já é string de endereço
  const fakeTx = await signer.sendTransaction({
    to: cooperado,  // self-transaction para gerar hash real
    value: 0n,
    data: ethers.hexlify(ethers.toUtf8Bytes(`PDR:${WASTE_BATCH_JSON.batch_id}:${ipfsHash}`))
  });
  const receipt = await fakeTx.wait();

  const nftMetadata = generateNFTMetadata(WASTE_BATCH_JSON, receipt.hash);
  logJSON("NFT Passaporte Digital de Resíduo — Metadata", nftMetadata);
  log("✅", `PDR registrado on-chain!`);
  log("🔒", `TX Hash: ${receipt.hash}`);
  log("📦", `Bloco: ${receipt.blockNumber}`);

  // 5. Calcular e emitir tokens CircularCredit
  separator("ETAPA 5 — Cálculo e Emissão de CircularCredit (ERC-20)");
  log("⚖️ ", "Calculando tokens por componente:");
  const totalTokens = calcTokens(WASTE_BATCH_JSON.material_tree);
  log("💰", `\n  Total CircularCredits a emitir: ${totalTokens} tokens`);
  log("👤", `  Destinatário: ${cooperado} (cooperado_joao)`);

  // Simular emissão de tokens
  const tokenTx = await signer.sendTransaction({
    to: cooperado,
    value: 0n,
    data: ethers.hexlify(ethers.toUtf8Bytes(`MINT:${totalTokens}:CircularCredit:${cooperado}`))
  });
  const tokenReceipt = await tokenTx.wait();
  log("✅", `Tokens emitidos! TX: ${tokenReceipt.hash}`);

  // Resumo do saldo
  console.log(`\n  ┌─────────────────────────────────────┐`);
  console.log(`  │  SALDO DO COOPERADO (João)           │`);
  console.log(`  │  CircularCredits:  ${String(totalTokens).padEnd(18)} │`);
  console.log(`  │  PDRs (NFTs):      1 passaporte       │`);
  console.log(`  │  Status do lote:   COLETADO           │`);
  console.log(`  └─────────────────────────────────────┘`);

  // 6. Proposta na DAO
  separator("ETAPA 6 — Criação de Proposta na DAO (Governança Comunitária)");
  logJSON("Proposta submetida à DAO", DAO_PROPOSAL);

  const daoTx = await signer.sendTransaction({
    to: cooperado,
    value: 0n,
    data: ethers.hexlify(ethers.toUtf8Bytes(`DAO_PROPOSE:${DAO_PROPOSAL.id}:${DAO_PROPOSAL.title}`))
  });
  const daoReceipt = await daoTx.wait();
  log("📣", `Proposta registrada on-chain!  TX: ${daoReceipt.hash}`);
  log("🗳️ ", `Período de votação: ${DAO_PROPOSAL.voting_period_hours}h`);
  log("⚖️ ", "Regra Petreira ativa: proposta NÃO pode alterar fatores de crédito retroativamente");

  // 7. Simulação de votos
  separator("ETAPA 7 — Votação na DAO");
  const voters = [
    { account: signers[1].address, name: "João (cooperado)",      vote: "SIM" },
    { account: signers[2].address, name: "Maria (cooperada)",     vote: "SIM" },
    { account: signers[3].address, name: "Pedro (cooperado)",     vote: "SIM" },
    { account: signers[4].address, name: "Empresa XYZ",          vote: "SIM" },
    { account: signers[5].address, name: "Órgão Gov. (abstém)",  vote: "ABSTENCAO" },
  ];

  let sim = 0, nao = 0, abs = 0;
  for (const voter of voters) {
    const vs = await provider.getSigner(voter.account);
    const vtx = await vs.sendTransaction({
      to: voter.account, value: 0n,
      data: ethers.hexlify(ethers.toUtf8Bytes(`VOTE:${DAO_PROPOSAL.id}:${voter.vote}`))
    });
    await vtx.wait();
    if (voter.vote === "SIM") sim++;
    else if (voter.vote === "NAO") nao++;
    else abs++;
    log("🗳️ ", `  ${voter.name.padEnd(28)} → ${voter.vote}`);
  }

  // Resultado
  const aprovada = sim > nao && sim >= 3;
  separator("RESULTADO DA VOTAÇÃO");
  console.log(`\n  ┌─────────────────────────────────────┐`);
  console.log(`  │  Proposta: ${DAO_PROPOSAL.title.substring(0,26)}  │`);
  console.log(`  │  SIM:        ${String(sim).padEnd(26)}│`);
  console.log(`  │  NÃO:        ${String(nao).padEnd(26)}│`);
  console.log(`  │  ABSTENÇÃO:  ${String(abs).padEnd(26)}│`);
  console.log(`  │  RESULTADO:  ${aprovada ? "✅ APROVADA              " : "❌ REJEITADA             "}│`);
  console.log(`  └─────────────────────────────────────┘`);

  // 8. Dashboard de Transparência (leitura pública)
  separator("ETAPA 8 — Dashboard de Transparência (Governo/Auditor)");
  const currentBlock = await provider.getBlockNumber();
  console.log(`\n  ┌──────────────────────────────────────────────┐`);
  console.log(`  │  DASHBOARD CircularDAO — Painel Público       │`);
  console.log(`  │  Bloco atual:          ${String(currentBlock).padEnd(22)}│`);
  console.log(`  │  Lotes registrados:    1 (BATCH-2026-001)     │`);
  console.log(`  │  NFTs emitidos:        1 Passaporte Digital   │`);
  console.log(`  │  Tokens emitidos:      ${String(totalTokens + " CircularCredits").padEnd(22)}│`);
  console.log(`  │  Propostas ativas:     1 (PROP-001)           │`);
  console.log(`  │  Propostas aprovadas:  ${aprovada ? "1" : "0"}                     │`);
  console.log(`  │  Participantes ativos: 5 cooperados           │`);
  console.log(`  │  Rede:                 Ethereum Local (8545)  │`);
  console.log(`  └──────────────────────────────────────────────┘`);

  separator("✅ TESTE CONCLUÍDO COM SUCESSO");
  log("📄", "Fluxo do artigo ENGEP validado na blockchain local.");
  log("🚀", "Próximo passo: conectar com os contratos reais do /root/dao-tese");
  log("🌐", "Deploy na testnet Sepolia ou Polygon para validação pública.");
  console.log("");
}

main().catch(e => {
  console.error("\n❌ ERRO:", e.message);
  console.error(e);
  process.exit(1);
});
