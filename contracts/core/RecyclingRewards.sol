// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./WasteCategoryRegistry.sol";
import "../tokens/CircularCredit.sol";
import "../tokens/MaterialPassport.sol";

/// @title RecyclingRewards — Emissão Automática de Créditos CRC
/// @notice Calcula e emite CircularCredit (CRC) ao reciclador quando um
///         passaporte atinge o status RECYCLED. Regra: peso(kg) × créditos/kg
/// @dev Escutado pelo evento WasteRecycled emitido pelo WasteTracker (off-chain)
///      ou chamado direto pelo WasteTracker (configuração on-chain)
contract RecyclingRewards is AccessControl, ReentrancyGuard {

    bytes32 public constant ADMIN_ROLE    = DEFAULT_ADMIN_ROLE;
    bytes32 public constant TRACKER_ROLE  = keccak256("TRACKER");      // Endereço do WasteTracker

    // ─── Referências ──────────────────────────────────────────────────
    WasteCategoryRegistry public categoryRegistry;
    CircularCredit        public creditToken;
    MaterialPassport      public passport;

    // ─── Parâmetros de Recompensa ────────────────────────────────────
    uint256 public bonusMultiplierBp = 10000; // 10000 = 1x, 12000 = 1.2x (20% bônus)
    uint256 public maxBonusMultiplierBp = 20000; // teto 2x

    // ─── Estado ───────────────────────────────────────────────────────
    mapping(uint256 => bool)    public rewardPaid;           // tokenId → pago
    mapping(address => uint256) public lifetimeEarnedByAddr; // créditos acumulados
    mapping(uint256 => uint256) public rewardByCat;          // créditos por categoria
    uint256                     public totalCreditsMinted;

    // ─── Eventos ──────────────────────────────────────────────────────
    event RewardIssued(
        uint256 indexed tokenId,
        address indexed recycler,
        uint256 categoryId,
        uint256 weightKg,
        uint256 creditsIssued,
        string  reason
    );
    event BonusMultiplierUpdated(uint256 oldBp, uint256 newBp);

    // ─── Constructor ──────────────────────────────────────────────────
    constructor(
        address admin,
        address categoryRegistryAddr,
        address creditTokenAddr,
        address passportAddr
    ) {
        _grantRole(ADMIN_ROLE, admin);
        categoryRegistry = WasteCategoryRegistry(categoryRegistryAddr);
        creditToken      = CircularCredit(creditTokenAddr);
        passport         = MaterialPassport(passportAddr);
    }

    // ─── Configuração ─────────────────────────────────────────────────
    function setTrackerRole(address tracker) external onlyRole(ADMIN_ROLE) {
        _grantRole(TRACKER_ROLE, tracker);
    }

    function setBonusMultiplier(uint256 bp) external onlyRole(ADMIN_ROLE) {
        require(bp >= 10000 && bp <= maxBonusMultiplierBp, "Rewards: multiplicador fora do limite");
        emit BonusMultiplierUpdated(bonusMultiplierBp, bp);
        bonusMultiplierBp = bp;
    }

    // ─── Emissão de Recompensa ────────────────────────────────────────

    /// @notice Chamado pelo WasteTracker ao concluir reciclagem
    /// @param tokenId     Token ERC-1155 do passaporte
    /// @param recycler    Endereço que recebe os créditos
    /// @param actualWeightKg Peso real reciclado (em kg — pode diferir do peso original)
    function issueReward(
        uint256 tokenId,
        address recycler,
        uint256 actualWeightKg
    ) external nonReentrant onlyRole(TRACKER_ROLE) {
        require(!rewardPaid[tokenId], "Rewards: recompensa ja emitida");
        require(recycler != address(0), "Rewards: recycler invalido");

        MaterialPassport.PassportCore memory p = passport.getPassportCore(tokenId);
        require(
            p.status == MaterialPassport.MaterialStatus.RECYCLED,
            "Rewards: passaporte precisa estar RECYCLED"
        );

        uint256 creditsPerKg = categoryRegistry.getCreditsPerKg(p.categoryId);
        require(creditsPerKg > 0, "Rewards: categoria sem pontuacao");

        // Calcula créditos: peso × crédito/kg × bônus
        // Lembrete: CRC tem 2 decimais → multiplicamos por 100 para escala
        uint256 rawCredits = (actualWeightKg * creditsPerKg * 100) / 1; // base
        uint256 finalCredits = (rawCredits * bonusMultiplierBp) / 10000;

        rewardPaid[tokenId]              = true;
        lifetimeEarnedByAddr[recycler]  += finalCredits;
        rewardByCat[p.categoryId]       += finalCredits;
        totalCreditsMinted              += finalCredits;

        string memory reason = string.concat(
            "Reciclagem token #",
            _uint2str(tokenId),
            " cat:",
            _uint2str(p.categoryId)
        );
        creditToken.mint(recycler, finalCredits, reason);

        emit RewardIssued(tokenId, recycler, p.categoryId, actualWeightKg, finalCredits, reason);
    }

    // ─── Views ────────────────────────────────────────────────────────

    /// @notice Simula quanto crédito seria emitido para um passaporte
    function previewReward(uint256 tokenId, uint256 weightKg) external view returns (uint256 credits) {
        MaterialPassport.PassportCore memory p = passport.getPassportCore(tokenId);
        uint256 creditsPerKg = categoryRegistry.getCreditsPerKg(p.categoryId);
        uint256 rawCredits   = weightKg * creditsPerKg * 100;
        return (rawCredits * bonusMultiplierBp) / 10000;
    }

    function getRecyclerBalance(address recycler) external view returns (uint256) {
        return creditToken.balanceOf(recycler);
    }

    function getCategoryRewards(uint256 categoryId) external view returns (uint256) {
        return rewardByCat[categoryId];
    }

    // ─── Utilidades ───────────────────────────────────────────────────
    function _uint2str(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 tmp = v;
        uint256 len;
        while (tmp != 0) { len++; tmp /= 10; }
        bytes memory buf = new bytes(len);
        while (v != 0) { buf[--len] = bytes1(uint8(48 + (v % 10))); v /= 10; }
        return string(buf);
    }
}
