// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/// @title GovernanceToken — Token de Governança da DAO Circular
/// @notice Usado para votação on-chain nas propostas da DAO
/// @dev ERC20Votes (OZ v5) herda ERC20 + Votes; Votes herda EIP712 (sem ctor próprio).
///      Para inicializar o domínio EIP712 é necessário chamar EIP712(name, version).
contract GovernanceToken is ERC20Votes, AccessControl {

    bytes32 public constant MINTER_ROLE = keccak256("MINTER");
    bytes32 public constant ADMIN_ROLE  = DEFAULT_ADMIN_ROLE;

    uint256 public constant MAX_SUPPLY = 10_000_000 * 10**18; // 10 milhões

    constructor(address admin)
        ERC20("DAO Circular Governance", "DAOG")
        EIP712("DAO Circular Governance", "1")
    {
        _grantRole(ADMIN_ROLE, admin);
        _mint(admin, 100_000 * 10**18);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        require(totalSupply() + amount <= MAX_SUPPLY, "Gov: supply maximo atingido");
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 amount)
        internal
        override(ERC20Votes)
    {
        super._update(from, to, amount);
    }
}
