// scripts/integrate-json.js
// ─────────────────────────────────────────────────────────────────────────────
// Recebe JSON do sistema do Alexandre (IDs de produto, árvore de produtos)
// e cunha um MaterialPassport na blockchain para cada item registrado.
//
// Uso:
//   npx hardhat run scripts/integrate-json.js --network localhost
//   INPUT_FILE=./sample-product.json npx hardhat run scripts/integrate-json.js --network localhost
//
// Formato esperado do JSON do Alexandre:
// {
//   "productId":     "ALX-2025-00137",
//   "productName":   "Monitor 24pol Dell",
//   "category":      "e-waste",
//   "weightKg":      5.2,
//   "producerAddr":  "0x...",   (opcional)
//   "dataURI":       "https://sistema-alexandre.com.br/produto/ALX-2025-00137",
//   "tree": [...]               (opcional — subcomponentes)
// }
// ─────────────────────────────────────────────────────────────────────────────

const hre    = require("hardhat");
const fs     = require("fs");
const crypto = require("crypto");
const path   = require("path");

// Mapeamento de código de categoria do Alexandre → categoryId on-chain
// Atualize conforme o WasteCategoryRegistry for sendo populado
const CATEGORY_MAP = {
  "plastic-pet":    0,
  "plastic":        0,
  "plastic-rigid":  1,
  "e-waste":        2,
  "e-waste-bat":    3,
  "paper":          4,
  "metal":          5,
  "metal-nf":       6,
  "glass":          7,
  "construction":   8,
  "textile":        9,
  "organic":        10,
  "oil":            11,
};

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  // ─── Carrega endereços do deploy ─────────────────────────────────
  const networkName  = hre.network.name;
  const deployFile   = path.resolve(`./deployments/${networkName}.json`);
  if (!fs.existsSync(deployFile)) {
    throw new Error(`Deploy não encontrado para a rede '${networkName}'. Execute deploy-all.js primeiro.`);
  }
  const deployAddrs = JSON.parse(fs.readFileSync(deployFile, "utf8"));
  console.log(`Rede: ${networkName}`);
  console.log(`MaterialPassport: ${deployAddrs.MaterialPassport}`);

  // ─── Instancia contratos ─────────────────────────────────────────
  const passport = await hre.ethers.getContractAt("MaterialPassport", deployAddrs.MaterialPassport);

  // ─── Lê JSON de input ────────────────────────────────────────────
  const inputFile = process.env.INPUT_FILE || "./sample-data/product-sample.json";
  if (!fs.existsSync(inputFile)) {
    console.log("Arquivo de input não encontrado. Gerando sample...");
    generateSampleJson(inputFile);
  }
  const rawJson  = fs.readFileSync(inputFile, "utf8");
  const products = JSON.parse(rawJson);
  const list     = Array.isArray(products) ? products : [products];

  console.log(`\nIntegrando ${list.length} produto(s)...\n`);

  const results = [];

  for (const product of list) {
    console.log(`→ Produto: ${product.productId} / ${product.productName}`);

    // Valida campos obrigatórios
    if (!product.productId || !product.category || !product.weightKg) {
      console.error(`  ✗ Campos obrigatórios faltando: productId, category, weightKg`);
      continue;
    }

    // Resolve categoryId
    const catKey = product.category.toLowerCase().trim();
    const categoryId = CATEGORY_MAP[catKey];
    if (categoryId === undefined) {
      console.error(`  ✗ Categoria desconhecida: ${product.category}`);
      continue;
    }

    // Verifica se já foi registrado (idempotência)
    try {
      const existing = await passport.getByExternalId(product.productId);
      if (existing.tokenId > 0n) {
        console.log(`  ↩ Já registrado como token #${existing.tokenId.toString()}`);
        continue;
      }
    } catch (_) { /* ainda não registrado */ }

    // Calcula hash SHA-256 do payload JSON (prova de integridade)
    const dataHash = "0x" + crypto.createHash("sha256").update(rawJson).digest("hex");

    // Destinatário: produtor informado ou deployer
    const toAddr = product.producerAddr || deployer.address;

    // Peso em gramas (contrato usa uint256)
    const weightKg = Math.round(product.weightKg);

    // URI para os dados completos
    const dataURI = product.dataURI || `https://sistema-alexandre.exemplo.br/produto/${product.productId}`;

    try {
      const tx = await passport.mint(
        toAddr,
        product.productId,
        dataHash,
        dataURI,
        categoryId,
        weightKg,
        `Registro via integrate-json.js — ${new Date().toISOString()}`
      );
      const receipt = await tx.wait();

      // Recupera tokenId do evento
      let tokenId = null;
      for (const log of receipt.logs) {
        try {
          const parsed = passport.interface.parseLog(log);
          if (parsed && parsed.name === "PassportMinted") {
            tokenId = parsed.args.tokenId.toString();
          }
        } catch (_) {}
      }

      console.log(`  ✓ TokenId #${tokenId} | TxHash: ${receipt.hash}`);
      results.push({ productId: product.productId, tokenId, txHash: receipt.hash, status: "ok" });

    } catch (err) {
      console.error(`  ✗ Erro ao cunhar passaporte: ${err.message}`);
      results.push({ productId: product.productId, status: "error", error: err.message });
    }
  }

  // ─── Salva resultado ─────────────────────────────────────────────
  const outFile = `./deployments/integration-result-${Date.now()}.json`;
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(`\nResultado salvo em ${outFile}`);
  console.log(`Sucesso: ${results.filter(r => r.status === "ok").length}/${list.length}`);
}

// ─── Gera JSON de exemplo ────────────────────────────────────────────────────
function generateSampleJson(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const sample = [
    {
      "productId":    "ALX-2025-00001",
      "productName":  "Monitor 24pol",
      "category":     "e-waste",
      "weightKg":     5.2,
      "dataURI":      "https://sistema-alexandre.exemplo.br/produto/ALX-2025-00001",
      "tree": [
        { "productId": "ALX-2025-00001-A", "name": "Tela LCD", "category": "e-waste", "weightKg": 2.1 },
        { "productId": "ALX-2025-00001-B", "name": "Placa PCB", "category": "e-waste", "weightKg": 0.8 }
      ]
    },
    {
      "productId":    "ALX-2025-00002",
      "productName":  "Garrafa PET 2L",
      "category":     "plastic-pet",
      "weightKg":     0.05,
      "dataURI":      "https://sistema-alexandre.exemplo.br/produto/ALX-2025-00002"
    }
  ];
  fs.writeFileSync(filePath, JSON.stringify(sample, null, 2));
  console.log(`Sample gerado em ${filePath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
