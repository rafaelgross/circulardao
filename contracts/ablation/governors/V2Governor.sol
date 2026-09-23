// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./AblationGovernorBase.sol";

/// @title V2Governor — historical voting power + fixed quorum (protocol 3.1)
/// @notice Same `_getVotes` as V1Governor (unmodified, historical). The only
///         difference from V1 is `quorum()`, which returns a FIXED token
///         amount instead of 0 — not a fraction of total supply, unlike the
///         Ref (CircularDAO) implementation's GovernorVotesQuorumFraction.
///         That's deliberate: it decouples V2's quorum from whatever total
///         supply a given condition mints, so V2 can share a token
///         deployment with V0/V1 across the full N-sweep (up to N=50)
///         without its quorum drifting — see the protocol's condition 4
///         note on why Ref cannot do the same.
contract V2Governor is AblationGovernorBase {
    uint256 public immutable fixedQuorum;

    constructor(IVotes token_, uint256 votingDelay_, uint256 votingPeriod_, uint256 fixedQuorum_)
        AblationGovernorBase("V2Governor", token_, votingDelay_, votingPeriod_)
    {
        fixedQuorum = fixedQuorum_;
    }

    function quorum(uint256) public view override returns (uint256) {
        return fixedQuorum;
    }
}
