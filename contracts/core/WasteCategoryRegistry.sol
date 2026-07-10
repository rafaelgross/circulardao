// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title WasteCategoryRegistry — Cadastro Dinâmico de Categorias de Resíduo
/// @notice Suporta qualquer tipo de resíduo parametrizável (escopo amplo da pesquisa)
/// @dev Cada categoria define: créditos por kg, periculosidade, cor de coleta, legislação aplicável
contract WasteCategoryRegistry is AccessControl {

    bytes32 public constant ADMIN_ROLE    = DEFAULT_ADMIN_ROLE;
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR");

    // ─── Estruturas ───────────────────────────────────────────────────
    enum Hazard { NONE, LOW, MEDIUM, HIGH, TOXIC }

    struct WasteCategory {
        uint256 id;
        string  name;              // Ex: "Plástico PET", "E-Waste", "Construção Civil"
        string  code;              // Ex: "PLASTIC_PET", "EWASTE", "CONSTRUCTION"
        string  color;             // Cor de coleta (verde, vermelho, amarelo, etc.)
        uint256 creditsPerKg;      // Créditos CircularCredit por kg processado (base 100 = 1.00x)
        Hazard  hazard;            // Nível de periculosidade
        string  regulation;        // Legislação aplicável (ex: "Decreto 10.240", "PNRS Art.33")
        string  description;
        bool    active;
        uint256 createdAt;
    }

    // ─── Estado ───────────────────────────────────────────────────────
    mapping(uint256 => WasteCategory) public categories;
    mapping(string  => uint256)       public codeToId;   // code → id
    uint256[]                         public categoryIds;
    uint256                           public nextId;

    // ─── Eventos ──────────────────────────────────────────────────────
    event CategoryAdded(uint256 indexed id, string code, string name, uint256 creditsPerKg);
    event CategoryUpdated(uint256 indexed id, uint256 newCreditsPerKg);
    event CategoryDeactivated(uint256 indexed id);

    // ─── Constructor ──────────────────────────────────────────────────
    constructor(address admin) {
        _grantRole(ADMIN_ROLE, admin);
        nextId = 1;

        // Pré-cadastrar categorias padrão (4R da pesquisa)
        _addCategory("Plastico PET",         "PLASTIC_PET",     "verde",    10, Hazard.NONE,   "PNRS Lei 12.305/2010");
        _addCategory("Plastico Rigido",      "PLASTIC_RIGID",   "verde",     8, Hazard.NONE,   "PNRS Lei 12.305/2010");
        _addCategory("E-Waste Geral",        "EWASTE_GENERAL",  "vermelho", 25, Hazard.HIGH,   "Decreto 10.240/2020");
        _addCategory("E-Waste Baterias",     "EWASTE_BATTERY",  "vermelho", 30, Hazard.TOXIC,  "Resolucao CONAMA 401/2008");
        _addCategory("Papel e Papelao",      "PAPER",           "azul",      5, Hazard.NONE,   "PNRS Lei 12.305/2010");
        _addCategory("Metal Ferroso",        "METAL_FERROUS",   "amarelo",  12, Hazard.NONE,   "PNRS Lei 12.305/2010");
        _addCategory("Metal Nao Ferroso",    "METAL_NON",       "amarelo",  20, Hazard.LOW,    "PNRS Lei 12.305/2010");
        _addCategory("Vidro",                "GLASS",           "cinza",     6, Hazard.NONE,   "PNRS Lei 12.305/2010");
        _addCategory("Construcao Civil",     "CONSTRUCTION",    "marrom",    3, Hazard.LOW,    "Resolucao CONAMA 307/2002");
        _addCategory("Textil",               "TEXTILE",         "laranja",   8, Hazard.NONE,   "PNRS Lei 12.305/2010");
        _addCategory("Organico Compostavel", "ORGANIC",         "marrom",    4, Hazard.NONE,   "PNRS Lei 12.305/2010");
        _addCategory("Oleo Lubrificante",    "OIL",             "vermelho", 15, Hazard.MEDIUM, "Resolucao CONAMA 362/2005");
    }

    // ─── Gestão de Categorias ─────────────────────────────────────────
    function addCategory(
        string calldata name,
        string calldata code,
        string calldata color,
        uint256         creditsPerKg,
        Hazard          hazard,
        string calldata regulation
    ) external onlyRole(ADMIN_ROLE) returns (uint256) {
        return _addCategory(name, code, color, creditsPerKg, hazard, regulation);
    }

    function _addCategory(
        string memory name,
        string memory code,
        string memory color,
        uint256       creditsPerKg,
        Hazard        hazard,
        string memory regulation
    ) internal returns (uint256 id) {
        require(codeToId[code] == 0, "Category: code ja existe");
        id = nextId++;

        categories[id] = WasteCategory({
            id:           id,
            name:         name,
            code:         code,
            color:        color,
            creditsPerKg: creditsPerKg,
            hazard:       hazard,
            regulation:   regulation,
            description:  "",
            active:       true,
            createdAt:    block.timestamp
        });

        codeToId[code] = id;
        categoryIds.push(id);

        emit CategoryAdded(id, code, name, creditsPerKg);
        return id;
    }

    function updateCredits(uint256 id, uint256 newCreditsPerKg) external onlyRole(ADMIN_ROLE) {
        require(categories[id].id != 0, "Category: nao encontrada");
        categories[id].creditsPerKg = newCreditsPerKg;
        emit CategoryUpdated(id, newCreditsPerKg);
    }

    function deactivate(uint256 id) external onlyRole(ADMIN_ROLE) {
        require(categories[id].id != 0, "Category: nao encontrada");
        categories[id].active = false;
        emit CategoryDeactivated(id);
    }

    // ─── Views ────────────────────────────────────────────────────────
    function getCategory(uint256 id) external view returns (WasteCategory memory) {
        require(categories[id].id != 0, "Category: nao encontrada");
        return categories[id];
    }

    function getCategoryByCode(string calldata code) external view returns (WasteCategory memory) {
        uint256 id = codeToId[code];
        require(id != 0, "Category: code nao encontrado");
        return categories[id];
    }

    function getAllCategories() external view returns (uint256[] memory) {
        return categoryIds;
    }

    function isValid(uint256 id) external view returns (bool) {
        return categories[id].id != 0 && categories[id].active;
    }

    function getCreditsPerKg(uint256 categoryId) external view returns (uint256) {
        require(categories[categoryId].id != 0, "Category: nao encontrada");
        return categories[categoryId].creditsPerKg;
    }
}
