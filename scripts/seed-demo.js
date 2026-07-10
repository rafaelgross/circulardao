// Seed resiliente — retoma do estado atual da chain
const { ethers } = require("ethers");
const cfg = require("/home/vmi2947226.contaboserver.net/public_html/dao-ui/contracts.json");

const RPC = "http://127.0.0.1:8545";
const PK0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

(async () => {
  const p = new ethers.JsonRpcProvider(RPC);
  const w = new ethers.Wallet(PK0, p);
  const nonce = async () => ({ nonce: await p.getTransactionCount(w.address, "pending") });
  const mine = n => p.send("hardhat_mine", ["0x" + n.toString(16)]);
  const A = cfg.addresses, B = cfg.abi;
  const dao = new ethers.Contract(A.dao, B.dao, w);
  const pass = new ethers.Contract(A.passport, B.passport, w);
  const track = new ethers.Contract(A.tracker, B.tracker, w);
  const cats = new ethers.Contract(A.categoryRegistry, B.categoryRegistry, p);

  const delay = Number(await dao.votingDelay());
  const period = Number(await dao.votingPeriod());

  // ---- Proposta 1 (Eletrônico): levar até execução ----
  const id1 = await dao.allProposalIds(0);
  let st = Number(await dao.state(id1));
  console.log("proposta 1 estado inicial:", st);
  if (st === 0) { await mine(delay + 1); st = Number(await dao.state(id1)); }
  if (st === 1) {
    if (!(await dao.hasVoted(id1, w.address)))
      await (await dao.castVote(id1, 1, await nonce())).wait();
    console.log("voto registrado; avançando", period, "blocos…");
    await mine(period + 1);
    st = Number(await dao.state(id1));
  }
  console.log("estado pós-votação:", st);
  if (st === 4) {
    const evs = await dao.queryFilter(dao.filters.ProposalCreated(), 0);
    const ev = evs.find(x => x.args[0].toString() === id1.toString());
    const a = ev.args;
    const descHash = ethers.keccak256(ethers.toUtf8Bytes(a[8]));
    await (await dao.execute([...a[2]], [...a[3]], [...a[5]], descHash, await nonce())).wait();
    console.log("proposta 1 executada — categoria Eletrônico ativa");
  }

  // ---- Proposta 2 (Plástico): deixar EM VOTAÇÃO ----
  if (Number(await dao.totalProposals()) < 2) {
    await (await dao.proposeAddCategory(
      "Plástico", "PLA", "#f4b942", 10n, 0, "PNRS Lei 12.305/2010",
      'Criar categoria "Plástico" valendo 10 créditos/kg',
      "Categoria para plásticos recicláveis (PET, PEAD, tampinhas). Proposta da campanha de coleta de tampinhas.",
      await nonce()
    )).wait();
    await mine(delay + 1);
    const id2 = await dao.allProposalIds(1);
    console.log("proposta 2 em votação, estado:", String(await dao.state(id2)));
  }

  // ---- Passaporte BATCH-2026-001 ----
  if (Number(await pass.totalPassports()) === 0) {
    const ids = await cats.getAllCategories();
    const catId = ids[ids.length - 1];
    const dados = JSON.stringify({ extId: "BATCH-2026-001", peso: 4, origem: "Cooperativa Verde Esperança" });
    await (await pass.mint({
      recipient: w.address,
      externalProductId: "BATCH-2026-001",
      externalDataHash: ethers.keccak256(ethers.toUtf8Bytes(dados)),
      externalDataURI: "",
      categoryId: catId,
      categoryCode: ethers.encodeBytes32String("ELE"),
      weightKg: 4n,
      composition: "Computadores Dell OptiPlex: placas-mãe, fontes e gabinetes",
      originLocation: "Cooperativa Verde Esperança, São Paulo/SP",
      isLot: true,
      quantity: 1n
    }, await nonce())).wait();
    const tokenId = Number(await pass.totalPassports());
    console.log("passaporte NFT emitido, token", tokenId);
    await (await track.registerCollection(tokenId, "Ponto de coleta Vila Mariana, São Paulo/SP", "Coleta da campanha de julho", await nonce())).wait();
    await (await track.registerTriagem(tokenId, "Galpão central da cooperativa", "Separado por tipo de componente", await nonce())).wait();
    console.log("etapas coleta + triagem registradas");
  }
  console.log("\nSEED CONCLUÍDO");
})().catch(e => { console.error("ERRO:", e.shortMessage || e.message); process.exit(1); });
