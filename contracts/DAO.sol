// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title DAO - Organização Autônoma Descentralizada (Tese)
/// @notice Contrato de governança DAO com propostas e votação
contract DAO is Ownable, ReentrancyGuard {
    // ----- Estruturas -----
    struct Proposal {
        uint256 id;
        address proposer;
        string description;
        uint256 voteFor;
        uint256 voteAgainst;
        uint256 deadline;
        bool executed;
        bool passed;
    }

    // ----- Estado -----
    uint256 public proposalCount;
    uint256 public votingPeriod = 3 days;
    uint256 public memberCount;

    mapping(uint256 => Proposal) public proposals;
    mapping(address => bool) public members;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    // ----- Eventos -----
    event MemberAdded(address indexed member);
    event MemberRemoved(address indexed member);
    event ProposalCreated(uint256 indexed id, address indexed proposer, string description);
    event Voted(uint256 indexed proposalId, address indexed voter, bool support);
    event ProposalExecuted(uint256 indexed id, bool passed);

    // ----- Modificadores -----
    modifier onlyMember() {
        require(members[msg.sender], "DAO: nao e membro");
        _;
    }

    modifier proposalExists(uint256 proposalId) {
        require(proposalId < proposalCount, "DAO: proposta nao encontrada");
        _;
    }

    // ----- Constructor -----
    constructor() Ownable(msg.sender) {
        // O deployer automaticamente entra como membro
        members[msg.sender] = true;
        memberCount++;
        emit MemberAdded(msg.sender);
    }

    // ----- Funções de Membros -----
    function addMember(address _member) external onlyOwner {
        require(!members[_member], "DAO: ja e membro");
        members[_member] = true;
        memberCount++;
        emit MemberAdded(_member);
    }

    function removeMember(address _member) external onlyOwner {
        require(members[_member], "DAO: nao e membro");
        require(_member != owner(), "DAO: nao pode remover o owner");
        members[_member] = false;
        memberCount--;
        emit MemberRemoved(_member);
    }

    // ----- Funções de Proposta -----
    function createProposal(string calldata _description) external onlyMember returns (uint256) {
        uint256 proposalId = proposalCount++;
        proposals[proposalId] = Proposal({
            id: proposalId,
            proposer: msg.sender,
            description: _description,
            voteFor: 0,
            voteAgainst: 0,
            deadline: block.timestamp + votingPeriod,
            executed: false,
            passed: false
        });
        emit ProposalCreated(proposalId, msg.sender, _description);
        return proposalId;
    }

    function vote(uint256 proposalId, bool support)
        external
        onlyMember
        proposalExists(proposalId)
    {
        Proposal storage proposal = proposals[proposalId];
        require(block.timestamp <= proposal.deadline, "DAO: votacao encerrada");
        require(!hasVoted[proposalId][msg.sender], "DAO: ja votou");

        hasVoted[proposalId][msg.sender] = true;
        if (support) {
            proposal.voteFor++;
        } else {
            proposal.voteAgainst++;
        }
        emit Voted(proposalId, msg.sender, support);
    }

    function executeProposal(uint256 proposalId)
        external
        onlyMember
        nonReentrant
        proposalExists(proposalId)
    {
        Proposal storage proposal = proposals[proposalId];
        require(block.timestamp > proposal.deadline, "DAO: votacao ainda ativa");
        require(!proposal.executed, "DAO: ja executada");

        proposal.executed = true;
        proposal.passed = proposal.voteFor > proposal.voteAgainst;
        emit ProposalExecuted(proposalId, proposal.passed);
    }

    // ----- Views -----
    function getProposal(uint256 proposalId)
        external
        view
        proposalExists(proposalId)
        returns (Proposal memory)
    {
        return proposals[proposalId];
    }

    function isMember(address _address) external view returns (bool) {
        return members[_address];
    }

    function setVotingPeriod(uint256 _days) external onlyOwner {
        require(_days >= 1 && _days <= 30, "DAO: periodo entre 1 e 30 dias");
        votingPeriod = _days * 1 days;
    }
}
