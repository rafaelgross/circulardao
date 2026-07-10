// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title CircularCredit — Token de Crédito de Circularidade (ERC-20)
/// @notice Emitido como recompensa por descarte/reciclagem correta de resíduos
/// @dev Minting controlado pelo RecyclingRewards; pode ser trocado por benefícios
contract CircularCredit is ERC20, ERC20Burnable, AccessControl {

    bytes32 public constant MINTER_ROLE = keccak256("MINTER");
    bytes32 public constant ADMIN_ROLE  = DEFAULT_ADMIN_ROLE;

    // ─── Estado ───────────────────────────────────────────────────────
    uint256 public totalMinted;
    uint256 public totalBurnedCredits;

    mapping(address => uint256) public lifetimeMinted;  // total mintado por endereço
    mapping(address => uint256) public lifetimeBurned;  // total queimado por endereço

    // ─── Eventos ──────────────────────────────────────────────────────
    event CreditsMinted(address indexed to, uint256 amount, string reason);
    event CreditsBurned(address indexed from, uint256 amount, string reason);

    // ─── Constructor ──────────────────────────────────────────────────
    constructor(address admin) ERC20("CircularCredit", "CRC") {
        _grantRole(ADMIN_ROLE, admin);
    }

    // ─── Minting (apenas MINTER_ROLE = contratos autorizados) ────────
    function mint(address to, uint256 amount, string calldata reason)
        external
        onlyRole(MINTER_ROLE)
    {
        _mint(to, amount);
        totalMinted += amount;
        lifetimeMinted[to] += amount;
        emit CreditsMinted(to, amount, reason);
    }

    /// @notice Queimar créditos para resgate de benefícios
    function burnWithReason(uint256 amount, string calldata reason) external {
        _burn(msg.sender, amount);
        totalBurnedCredits += amount;
        lifetimeBurned[msg.sender] += amount;
        emit CreditsBurned(msg.sender, amount, reason);
    }

    // ─── Views ────────────────────────────────────────────────────────
    function decimals() public pure override returns (uint8) {
        return 2; // 1 crédito = 100 unidades mínimas (facilita divisão por kg)
    }

    function getStats() external view returns (
        uint256 supply,
        uint256 minted,
        uint256 burned
    ) {
        return (totalSupply(), totalMinted, totalBurnedCredits);
    }
}
