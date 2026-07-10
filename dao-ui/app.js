const state = {
  config: null,
  provider: null,
  signer: null,
  account: null,
  dao: null,
  token: null,
  registry: null,
  rewards: null,
  stakeholders: null
};

// ── TOGGLE CLARO / ESCURO ─────────────────────────────────────────────────────
(function initTheme() {
  const btn = document.getElementById("themeToggleBtn");
  if (!btn) return;

  function applyTheme(isDark) {
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("dao-theme", isDark ? "dark" : "light");
    btn.querySelector(".toggle-icon").textContent = isDark ? "🌙" : "☀️";
    btn.querySelector(".toggle-label").textContent = isDark ? "Escuro" : "Claro";
    btn.title = isDark ? "Mudar para tema claro" : "Mudar para tema escuro";
  }

  const saved = localStorage.getItem("dao-theme");
  applyTheme(saved === "dark");

  btn.addEventListener("click", function () {
    applyTheme(!document.documentElement.classList.contains("dark"));
  });
})();

const proposalTypeMap = {
  0: { label: "Geral", target: null },
  1: { label: "Nova categoria", target: "categoryRegistry" },
  2: { label: "Atualizar créditos", target: "categoryRegistry" },
  3: { label: "Admitir validador", target: "stakeholders" },
  4: { label: "Revogar validador", target: "stakeholders" },
  5: { label: "Financiar projeto 4R", target: null },
  6: { label: "Atualizar bônus", target: "rewards" }
};

const els = {
  connectBtn: document.getElementById("connectBtn"),
  switchBtn: document.getElementById("switchBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  reloadProposalsBtn: document.getElementById("reloadProposalsBtn"),
  delegateBtn: document.getElementById("delegateBtn"),
  clearLogBtn: document.getElementById("clearLogBtn"),
  walletAddress: document.getElementById("walletAddress"),
  networkName: document.getElementById("networkName"),
  tokenBalance: document.getElementById("tokenBalance"),
  votingPower: document.getElementById("votingPower"),
  delegateState: document.getElementById("delegateState"),
  proposalCount: document.getElementById("proposalCount"),
  contractList: document.getElementById("contractList"),
  proposalList: document.getElementById("proposalList"),
  logOutput: document.getElementById("logOutput"),
  tabs: [...document.querySelectorAll(".tab")],
  panels: [...document.querySelectorAll(".tab-panel")],
  categoryForm: document.getElementById("categoryForm"),
  creditsForm: document.getElementById("creditsForm"),
  validatorForm: document.getElementById("validatorForm"),
  bonusForm: document.getElementById("bonusForm")
};

init().catch(handleError);

async function init() {
  state.config = await fetch("./contracts.json", { cache: "no-store" }).then((r) => r.json());
  renderContracts();
  bindEvents();
  log("Configuração da interface carregada.");

  if (window.ethereum) {
    window.ethereum.on("accountsChanged", async (accounts) => {
      state.account = accounts[0] || null;
      await reconnectIfPossible();
    });
    window.ethereum.on("chainChanged", async () => {
      await reconnectIfPossible();
    });
  } else {
    log("MetaMask não detectada. Instale uma carteira EVM compatível.", true);
  }
}

function bindEvents() {
  els.connectBtn.addEventListener("click", connectWallet);
  els.switchBtn.addEventListener("click", ensureNetwork);
  els.refreshBtn.addEventListener("click", refreshDashboard);
  els.reloadProposalsBtn.addEventListener("click", loadProposals);
  els.delegateBtn.addEventListener("click", delegateVotesToSelf);
  els.clearLogBtn.addEventListener("click", () => { els.logOutput.textContent = ""; });

  for (const tab of els.tabs) {
    tab.addEventListener("click", () => activateTab(tab.dataset.tab));
  }

  els.categoryForm.addEventListener("submit", onCategorySubmit);
  els.creditsForm.addEventListener("submit", onCreditsSubmit);
  els.validatorForm.addEventListener("submit", onValidatorSubmit);
  els.bonusForm.addEventListener("submit", onBonusSubmit);
}

function activateTab(key) {
  els.tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === key));
  els.panels.forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${key}`));
}

function renderContracts() {
  const entries = Object.entries(state.config.addresses);
  els.contractList.innerHTML = entries
    .map(([key, value]) => `
      <div class="contract-item">
        <strong>${formatLabel(key)}</strong><br />
        <small>${value}</small>
      </div>
    `)
    .join("");
}

async function connectWallet() {
  if (!window.ethereum) {
    return log("Nenhuma carteira compatível detectada no navegador.", true);
  }

  await ensureNetwork();
  const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
  state.account = accounts[0] || null;
  await reconnectIfPossible();
}

async function ensureNetwork() {
  if (!window.ethereum) return;
  const desiredChainHex = ethers.toBeHex(state.config.chainId);
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: desiredChainHex }]
    });
  } catch (err) {
    if (err.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: desiredChainHex,
          chainName: state.config.chainName,
          rpcUrls: [state.config.rpcUrl],
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }
        }]
      });
    } else if (err.code !== 4001) {
      throw err;
    }
  }
}

async function reconnectIfPossible() {
  if (!window.ethereum || !state.account) {
    resetConnectionState();
    return;
  }

  state.provider = new ethers.BrowserProvider(window.ethereum);
  state.signer = await state.provider.getSigner();
  state.account = await state.signer.getAddress();

  state.dao = new ethers.Contract(state.config.addresses.dao, state.config.abi.dao, state.signer);
  state.token = new ethers.Contract(state.config.addresses.governanceToken, state.config.abi.governanceToken, state.signer);
  state.registry = new ethers.Contract(state.config.addresses.categoryRegistry, state.config.abi.categoryRegistry, state.signer);
  state.rewards = new ethers.Contract(state.config.addresses.rewards, state.config.abi.rewards, state.signer);
  state.stakeholders = new ethers.Contract(state.config.addresses.stakeholders, state.config.abi.stakeholders, state.signer);

  log(`Carteira conectada: ${short(state.account)}`);
  await refreshDashboard();
}

function resetConnectionState() {
  els.walletAddress.textContent = "Não conectada";
  els.networkName.textContent = "—";
  els.tokenBalance.textContent = "—";
  els.votingPower.textContent = "—";
  els.delegateState.textContent = "—";
  els.proposalCount.textContent = "—";
  els.proposalList.className = "proposal-list empty-state";
  els.proposalList.textContent = "Conecte a carteira para carregar as propostas da DAO.";
}

async function refreshDashboard() {
  if (!state.signer) return log("Conecte a carteira antes de atualizar o painel.", true);

  const network = await state.provider.getNetwork();
  const [balance, votes, delegate, proposalCount] = await Promise.all([
    state.token.balanceOf(state.account),
    state.token.getVotes(state.account),
    state.token.delegates(state.account),
    state.dao.totalProposals()
  ]);

  els.walletAddress.textContent = state.account;
  els.networkName.textContent = `${network.name} (${network.chainId})`;
  els.tokenBalance.textContent = ethers.formatUnits(balance, 18);
  els.votingPower.textContent = ethers.formatUnits(votes, 18);
  els.delegateState.textContent = delegate === ethers.ZeroAddress ? "Sem delegação" : short(delegate);
  els.proposalCount.textContent = proposalCount.toString();

  await loadProposals();
}

async function delegateVotesToSelf() {
  if (!state.token || !state.account) return;
  const tx = await state.token.delegate(state.account);
  log(`Delegação enviada: ${tx.hash}`);
  await tx.wait();
  log("Votos delegados para o próprio endereço.");
  await refreshDashboard();
}

async function loadProposals() {
  if (!state.dao) return;
  const total = Number(await state.dao.totalProposals());
  if (total === 0) {
    els.proposalList.className = "proposal-list empty-state";
    els.proposalList.textContent = "Nenhuma proposta registrada até o momento.";
    return;
  }

  const items = [];
  for (let i = total - 1; i >= 0; i -= 1) {
    const proposalId = await state.dao.allProposalIds(i);
    const [meta, summary, label, snapshot, deadline] = await Promise.all([
      state.dao.getProposalMeta(proposalId),
      state.dao.getVoteSummary(proposalId),
      state.dao.getProposalStateLabel(proposalId),
      state.dao.proposalSnapshot(proposalId),
      state.dao.proposalDeadline(proposalId)
    ]);

    let hasVoted = false;
    try {
      hasVoted = await state.dao.hasVoted(proposalId, state.account);
    } catch (_) {}

    items.push({ proposalId, meta, summary, label, snapshot, deadline, hasVoted });
  }

  els.proposalList.className = "proposal-list";
  els.proposalList.innerHTML = items.map(renderProposalCard).join("");
  bindProposalActions(items);
}

function renderProposalCard(item) {
  const typeInfo = proposalTypeMap[Number(item.meta.pType)] || proposalTypeMap[0];
  const badgeClass = badgeClassForState(item.label);
  return `
    <article class="proposal-card" data-proposal-id="${item.proposalId}">
      <div class="proposal-top">
        <div>
          <div class="badge ${badgeClass}">${item.label}</div>
          <h3>${escapeHtml(item.meta.title || `Proposta ${item.proposalId}`)}</h3>
          <p class="muted">${escapeHtml(item.meta.description || "Sem descrição")}</p>
        </div>
        <div class="muted">Tipo: ${typeInfo.label}</div>
      </div>
      <div class="proposal-meta">
        <div><span class="label">ID</span><strong>${item.proposalId}</strong></div>
        <div><span class="label">Proponente</span><strong>${short(item.meta.proposer)}</strong></div>
        <div><span class="label">Snapshot</span><strong>${item.snapshot}</strong></div>
        <div><span class="label">Deadline</span><strong>${item.deadline}</strong></div>
      </div>
      <div class="vote-grid">
        <div><span class="label">A favor</span><strong>${formatVotes(item.summary[0])}</strong></div>
        <div><span class="label">Contra</span><strong>${formatVotes(item.summary[1])}</strong></div>
        <div><span class="label">Abstenções</span><strong>${formatVotes(item.summary[2])}</strong></div>
        <div><span class="label">Já votei</span><strong>${item.hasVoted ? "Sim" : "Não"}</strong></div>
      </div>
      <div class="vote-actions">
        <button class="btn vote-for" data-action="vote" data-support="1" data-id="${item.proposalId}">Votar a favor</button>
        <button class="btn vote-against" data-action="vote" data-support="0" data-id="${item.proposalId}">Votar contra</button>
        <button class="btn vote-abstain" data-action="vote" data-support="2" data-id="${item.proposalId}">Abster-se</button>
        <button class="btn tertiary" data-action="execute" data-id="${item.proposalId}">Executar proposta</button>
      </div>
    </article>
  `;
}

function bindProposalActions(items) {
  document.querySelectorAll("[data-action='vote']").forEach((button) => {
    button.addEventListener("click", async () => {
      await castVote(button.dataset.id, Number(button.dataset.support));
    });
  });

  document.querySelectorAll("[data-action='execute']").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.id;
      const item = items.find((entry) => entry.proposalId.toString() === id);
      await executeProposal(item);
    });
  });
}

async function castVote(proposalId, support) {
  const labels = ["contra", "a favor", "abstenção"];
  const tx = await state.dao.castVote(proposalId, support);
  log(`Voto ${labels[support]} enviado para proposta ${proposalId}: ${tx.hash}`);
  await tx.wait();
  log(`Voto confirmado para proposta ${proposalId}.`);
  await loadProposals();
}

async function executeProposal(item) {
  if (!item) return;
  const typeInfo = proposalTypeMap[Number(item.meta.pType)] || proposalTypeMap[0];
  if (!typeInfo.target) {
    return log("Esta proposta não possui alvo de execução mapeado na interface.", true);
  }

  const target = state.config.addresses[typeInfo.target];
  const values = [0n];
  const targets = [target];
  const calldatas = [item.meta.encodedData];
  const descriptionHash = ethers.id(item.meta.description);

  const tx = await state.dao.execute(targets, values, calldatas, descriptionHash);
  log(`Execução enviada para proposta ${item.proposalId}: ${tx.hash}`);
  await tx.wait();
  log(`Proposta ${item.proposalId} executada com sucesso.`);
  await loadProposals();
}

async function onCategorySubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const tx = await state.dao.proposeAddCategory(
    form.get("code"),
    form.get("name"),
    form.get("unit"),
    Number(form.get("creditsPerKg")),
    Number(form.get("hazardLevel")),
    form.get("regulation"),
    form.get("title"),
    form.get("description")
  );
  log(`Proposta de nova categoria enviada: ${tx.hash}`);
  await tx.wait();
  log("Proposta de categoria registrada.");
  event.currentTarget.reset();
  await refreshDashboard();
}

async function onCreditsSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const tx = await state.dao.proposeUpdateCreditWeight(
    Number(form.get("categoryId")),
    Number(form.get("newCreditsPerKg")),
    form.get("title"),
    form.get("description")
  );
  log(`Proposta de atualização de créditos enviada: ${tx.hash}`);
  await tx.wait();
  log("Proposta de atualização registrada.");
  event.currentTarget.reset();
  await refreshDashboard();
}

async function onValidatorSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const tx = await state.dao.proposeAdmitValidator(
    form.get("validator"),
    form.get("title"),
    form.get("description")
  );
  log(`Proposta de admissão de validador enviada: ${tx.hash}`);
  await tx.wait();
  log("Proposta de validador registrada.");
  event.currentTarget.reset();
  await refreshDashboard();
}

async function onBonusSubmit(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const tx = await state.dao.proposeUpdateBonus(
    Number(form.get("newBp")),
    form.get("title"),
    form.get("description")
  );
  log(`Proposta de bônus enviada: ${tx.hash}`);
  await tx.wait();
  log("Proposta de bônus registrada.");
  event.currentTarget.reset();
  await refreshDashboard();
}

function log(message, isError = false) {
  const line = `[${new Date().toLocaleTimeString("pt-BR")}] ${message}`;
  els.logOutput.textContent = `${line}\n${els.logOutput.textContent}`.trim();
  if (isError) {
    console.error(message);
  }
}

function handleError(error) {
  console.error(error);
  const message = error?.reason || error?.shortMessage || error?.message || String(error);
  log(message, true);
}

function badgeClassForState(label) {
  if (["Aprovada", "Executada"].includes(label)) return "success";
  if (["Pendente", "Em Votacao", "Em Fila"].includes(label)) return "warning";
  if (["Reprovada", "Cancelada", "Expirada"].includes(label)) return "danger";
  return "info";
}

function short(value) {
  if (!value || value.length < 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function formatLabel(key) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function formatVotes(value) {
  try {
    return ethers.formatUnits(value, 18);
  } catch (_) {
    return value?.toString?.() || "0";
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
