// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/governance/Governor.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorCountingSimple.sol";
import "@openzeppelin/contracts/governance/extensions/GovernorVotes.sol";

/// @title AblationGovernorBase — shared scaffolding for V0/V1/V2 (protocol 3.1)
/// @notice Everything the protocol requires to be IDENTICAL across V0, V1 and
///         V2 lives here: voting delay/period, strict majority counting
///         (GovernorCountingSimple — for > against, unmodified), no timelock,
///         no proposal threshold, and Governor's own propose()/execute()
///         logic (also unmodified). The ONLY things each variant overrides
///         are `_getVotes` (current vs. historical power) and `quorum`
///         (none, or a fixed value) — see V0Governor/V1Governor/V2Governor.
///         This mirrors CircularDAO's absence of a timelock so the
///         V2-vs-Ref comparison in section 3.1 isn't confounded by that.
abstract contract AblationGovernorBase is Governor, GovernorCountingSimple, GovernorVotes {
    uint256 private immutable _votingDelayBlocks;
    uint256 private immutable _votingPeriodBlocks;

    constructor(string memory name_, IVotes token_, uint256 votingDelay_, uint256 votingPeriod_)
        Governor(name_)
        GovernorVotes(token_)
    {
        _votingDelayBlocks = votingDelay_;
        _votingPeriodBlocks = votingPeriod_;
    }

    function votingDelay() public view override returns (uint256) {
        return _votingDelayBlocks;
    }

    function votingPeriod() public view override returns (uint256) {
        return _votingPeriodBlocks;
    }

    function proposalThreshold() public pure override returns (uint256) {
        return 0;
    }

    // GovernorCountingSimple requires this override in OZ v5, same as CircularDAO.
    function COUNTING_MODE() public pure override(GovernorCountingSimple, IGovernor) returns (string memory) {
        return "support=bravo&quorum=for,abstain";
    }
}
