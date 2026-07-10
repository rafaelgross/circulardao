// Experimento Seção 6.2 — ciclo de governança na Sepolia com 3 carteiras votantes.
// Idempotente: o progresso fica em deployments/sepolia-experiment.json; re-executar retoma de onde parou.
// Uso: npx hardhat run scripts/sepolia-cycle.js --network sepolia
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(__dirname, "../deployments/sepolia-experiment.json");
const DEP = require("../deployments/sepolia.json");
const VOTING_DELAY = 1;
const VOTING_PERIOD = 60; // blocos (~12 min na Sepolia)
const FUND_ETH = "0.003";
const DAOG_PER_VOTER = "20000";

const state = fs.existsSync(STATE_FILE)
  ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
  : { txs: [], voters: {} };
const save = () => { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); fs.chmodSync(STATE_FILE, 0o600); };
const done = (k) => state[k] === true;
const mark = (k) => { state[k] = true; save(); };

// Envia uma tx, espera o recibo e registra métricas (hash, bloco, gás, custo, latência)
async function tracked(label, signerName, promiseFn) {
  const t0 = Date.now();
  const tx = await promiseFn();
  const rc = await tx.wait();
  const latencyMs = Date.now() - t0;
  const rec = {
    label, signer: signerName,
    hash: rc.hash, block: rc.blockNumber,
    gasUsed: rc.gasUsed.toString(),
    effectiveGasPriceGwei: hre.ethers.formatUnits(rc.gasPrice ?? rc.effectiveGasPrice ?? 0n, "gwei"),
    costEth: hre.ethers.formatEther(rc.gasUsed * (rc.gasPrice ?? rc.effectiveGasPrice ?? 0n)),
    latencyMs,
  };
  state.txs.push(rec); save();
  console.log(`  ✓ ${label} | bloco ${rec.block} | gás ${rec.gasUsed} | ${(latencyMs / 1000).toFixed(1)} s | ${rec.hash}`);
  return rc;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForBlock(provider, target) {
  let bn = await provider.getBlockNumber();
  while (bn < target) {
    process.stdout.write(`    bloco ${bn}/${target}\r`);
    await sleep(20000);
    bn = await provider.getBlockNumber();
  }
  console.log(`    bloco ${bn} alcançado          `);
}

async function main() {
  const provider = hre.ethers.provider;
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address,
    "| saldo:", hre.ethers.formatEther(await provider.getBalance(deployer.address)), "ETH");

  const gov = await hre.ethers.getContractAt("GovernanceToken", DEP.GovernanceToken_DAOG, deployer);
  const categories = await hre.ethers.getContractAt("WasteCategoryRegistry", DEP.WasteCategoryRegistry, deployer);
  const rewards = await hre.ethers.getContractAt("RecyclingRewards", DEP.RecyclingRewards, deployer);
  const stakeholders = await hre.ethers.getContractAt("StakeholderRegistry", DEP.StakeholderRegistry, deployer);

  // ── 1. Redeploy do CircularDAO com período curto ─────────────────────
  if (!state.daoAddress) {
    console.log(`1. Deploy CircularDAO (delay=${VOTING_DELAY}, period=${VOTING_PERIOD} blocos)…`);
    const t0 = Date.now();
    const dao_ = await (await hre.ethers.getContractFactory("CircularDAO")).deploy(
      DEP.GovernanceToken_DAOG, deployer.address, DEP.WasteCategoryRegistry,
      DEP.RecyclingRewards, DEP.StakeholderRegistry, VOTING_DELAY, VOTING_PERIOD);
    const rc = await dao_.deploymentTransaction().wait();
    state.daoAddress = await dao_.getAddress();
    state.txs.push({
      label: "deploy CircularDAO", signer: "deployer",
      hash: rc.hash, block: rc.blockNumber, gasUsed: rc.gasUsed.toString(),
      effectiveGasPriceGwei: hre.ethers.formatUnits(rc.gasPrice, "gwei"),
      costEth: hre.ethers.formatEther(rc.gasUsed * rc.gasPrice),
      latencyMs: Date.now() - t0,
    });
    save();
    console.log("  ✓ CircularDAO:", state.daoAddress, "| gás", rc.gasUsed.toString());
  } else console.log("1. CircularDAO já publicado:", state.daoAddress);
  const dao = await hre.ethers.getContractAt("CircularDAO", state.daoAddress, deployer);

  // ── 2. Roles para a nova DAO ─────────────────────────────────────────
  if (!done("rolesGranted")) {
    console.log("2. Concedendo ADMIN_ROLE à nova DAO…");
    for (const [n, c] of [["WasteCategoryRegistry", categories], ["RecyclingRewards", rewards], ["StakeholderRegistry", stakeholders]]) {
      const role = await c.ADMIN_ROLE();
      if (await c.hasRole(role, state.daoAddress)) { console.log(`  ${n}: já concedido`); continue; }
      await tracked(`grantRole ${n}→DAO`, "deployer", () => c.grantRole(role, state.daoAddress));
    }
    mark("rolesGranted");
  } else console.log("2. Roles ok");

  // ── 3. Carteiras votantes ────────────────────────────────────────────
  if (!state.voters.v2) {
    state.voters.v2 = hre.ethers.Wallet.createRandom().privateKey;
    state.voters.v3 = hre.ethers.Wallet.createRandom().privateKey;
    save();
  }
  const voter2 = new hre.ethers.Wallet(state.voters.v2, provider);
  const voter3 = new hre.ethers.Wallet(state.voters.v3, provider);
  console.log("3. Votante 2:", voter2.address, "| Votante 3:", voter3.address);

  if (!done("funded")) {
    for (const [name, v] of [["votante2", voter2], ["votante3", voter3]]) {
      if ((await provider.getBalance(v.address)) > 0n) continue;
      await tracked(`financiar ${name} (${FUND_ETH} ETH)`, "deployer",
        () => deployer.sendTransaction({ to: v.address, value: hre.ethers.parseEther(FUND_ETH) }));
    }
    mark("funded");
  }

  if (!done("daogDistributed")) {
    for (const [name, v] of [["votante2", voter2], ["votante3", voter3]]) {
      if ((await gov.balanceOf(v.address)) > 0n) continue;
      await tracked(`transferir ${DAOG_PER_VOTER} DAOG → ${name}`, "deployer",
        () => gov.transfer(v.address, hre.ethers.parseEther(DAOG_PER_VOTER)));
    }
    mark("daogDistributed");
  }

  if (!done("delegated")) {
    for (const [name, v] of [["votante2", voter2], ["votante3", voter3]]) {
      if ((await gov.delegates(v.address)) === v.address) continue;
      await tracked(`delegate ${name}→si mesmo`, name, () => gov.connect(v).delegate(v.address));
    }
    mark("delegated");
  }

  // ── 4. Proposta ──────────────────────────────────────────────────────
  if (!state.proposalId) {
    console.log("4. Criando proposta on-chain…");
    // ordem posicional real de addCategory: (name, code, color, creditsPerKg, hazard, regulation)
    const rc = await tracked("proposeAddCategory Eletrônico de Informática", "deployer", () =>
      dao.proposeAddCategory(
        "Eletrônico de Informática", "EWASTE_IT", "#4a90d9", 25n, 2,
        "Decreto Federal 10.240/2020 (logística reversa de eletroeletrônicos)",
        'Cadastrar categoria "Eletrônico de Informática" a 25 CRC/kg',
        "Categoria para equipamentos de informática (lote BATCH-2026-001, Cooperativa Verde Esperança). Fator de crédito de 25 CRC/kg, periculosidade média."
      ));
    const ev = rc.logs.map((l) => { try { return dao.interface.parseLog(l); } catch { return null; } })
      .find((l) => l && l.name === "ProposalCreated");
    state.proposalId = ev.args[0].toString();
    state.proposalArgs = {
      targets: [...ev.args[2]], values: ev.args[3].map(String),
      calldatas: [...ev.args[5]], description: ev.args[8],
      voteStart: ev.args[6].toString(), voteEnd: ev.args[7].toString(),
    };
    save();
    console.log("  proposalId:", state.proposalId, "| votação: blocos", state.proposalArgs.voteStart, "→", state.proposalArgs.voteEnd);
  } else console.log("4. Proposta já criada:", state.proposalId);

  // ── 5. Votação (3 carteiras independentes) ───────────────────────────
  const id = BigInt(state.proposalId);
  await waitForBlock(provider, Number(state.proposalArgs.voteStart) + 1);
  console.log("5. Estado da proposta:", String(await dao.state(id)), "(1=Active)");
  const votos = [["deployer", deployer, 1], ["votante2", voter2, 1], ["votante3", voter3, 0]];
  for (const [name, signer, support] of votos) {
    if (await dao.hasVoted(id, signer.address)) { console.log(`  ${name}: já votou`); continue; }
    await tracked(`castVote ${name} (${support === 1 ? "a favor" : "contra"})`, name,
      () => dao.connect(signer).castVote(id, support));
  }
  const v = await dao.proposalVotes(id);
  console.log("  Placar — contra:", hre.ethers.formatEther(v[0]),
    "| a favor:", hre.ethers.formatEther(v[1]), "| abstenção:", hre.ethers.formatEther(v[2]));

  // ── 6. Fim do período e execução ─────────────────────────────────────
  console.log("6. Aguardando fim da votação (bloco", state.proposalArgs.voteEnd + ")…");
  await waitForBlock(provider, Number(state.proposalArgs.voteEnd) + 1);
  let st = Number(await dao.state(id));
  console.log("  Estado:", st, "(4=Succeeded)");
  if (st === 4) {
    const descHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(state.proposalArgs.description));
    await tracked("execute proposta", "deployer", () =>
      dao.execute(state.proposalArgs.targets, state.proposalArgs.values.map(BigInt),
        state.proposalArgs.calldatas, descHash));
    st = Number(await dao.state(id));
  }
  console.log("  Estado final:", st, "(7=Executed)");

  const cats = await categories.getAllCategories();
  const last = await categories.getCategory(cats[cats.length - 1]);
  console.log("  Última categoria:", last.name, "|", last.code, "| CRC/kg:", String(last.creditsPerKg));

  state.finalState = st;
  state.completedAt = new Date().toISOString();
  save();
  console.log("\nEXPERIMENTO CONCLUÍDO — métricas em", STATE_FILE);
}

main().catch((e) => { console.error("ERRO:", e.shortMessage || e.message); process.exit(1); });
