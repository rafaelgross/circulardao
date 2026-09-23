# Slither static analysis — CircularDAO

Slither 0.11.6, run against the post-fix contracts (C1-C7 applied). 40 findings touch our own contracts (contracts/); the rest are in OpenZeppelin dependencies under node_modules/ and are not reproduced here.

| Impact | Check | Location | Note |
|---|---|---|---|
| Low | shadowing-local | contracts/core/CircularDAO.sol#86 | CircularDAO.constructor(IVotes,address,address,address,address,uint48,uint32).token (contr |
| Low | shadowing-local | contracts/core/CircularDAO.sol#114 | CircularDAO.proposeAddCategory(string,string,string,uint256,uint8,string,string,string).na |
| Low | events-maths | contracts/DAO.sol#137 | DAO.setVotingPeriod(uint256) (contracts/DAO.sol#137-140) should emit an event for:  |
| Low | reentrancy-benign | contracts/core/WasteTracker.sol#108 | Reentrancy in WasteTracker.registerTriagem(uint256,string,string) (contracts/core/WasteTra |
| Low | reentrancy-benign | contracts/core/WasteTracker.sol#100 | Reentrancy in WasteTracker.registerTransit(uint256,address,string) (contracts/core/WasteTr |
| Low | reentrancy-benign | contracts/core/WasteTracker.sol#207 | Reentrancy in WasteTracker.registerCollection(uint256,string,string) (contracts/core/Waste |
| Low | reentrancy-benign | contracts/core/WasteTracker.sol#166 | Reentrancy in WasteTracker.registerReinserted(uint256,string) (contracts/core/WasteTracker |
| Low | reentrancy-benign | contracts/core/WasteTracker.sol#144 | Reentrancy in WasteTracker.registerRecycled(uint256,uint256,string) (contracts/core/WasteT |
| Low | reentrancy-benign | contracts/core/WasteTracker.sol#127 | Reentrancy in WasteTracker.registerProcessing(uint256,string) (contracts/core/WasteTracker |
| Low | timestamp | contracts/core/WasteCategoryRegistry.sol#104 | WasteCategoryRegistry.updateCredits(uint256,uint256) (contracts/core/WasteCategoryRegistry |
| Low | timestamp | contracts/tokens/MaterialPassport.sol#148 | MaterialPassport.updateStatus(uint256,MaterialPassport.MaterialStatus,string) (contracts/t |
| Low | timestamp | contracts/DAO.sol#90 | DAO.vote(uint256,bool) (contracts/DAO.sol#90-106) uses timestamp for comparisons |
| Low | timestamp | contracts/DAO.sol#108 | DAO.executeProposal(uint256) (contracts/DAO.sol#108-121) uses timestamp for comparisons |
| Low | timestamp | contracts/core/WasteCategoryRegistry.sol#132 | WasteCategoryRegistry.isValid(uint256) (contracts/core/WasteCategoryRegistry.sol#132-134)  |
| Low | timestamp | contracts/tokens/MaterialPassport.sol#193 | MaterialPassport.getPassportCore(uint256) (contracts/tokens/MaterialPassport.sol#193-196)  |
| Low | timestamp | contracts/tokens/MaterialPassport.sol#171 | MaterialPassport.transferHolder(uint256,address,string) (contracts/tokens/MaterialPassport |
| Low | timestamp | contracts/core/WasteCategoryRegistry.sol#117 | WasteCategoryRegistry.getCategory(uint256) (contracts/core/WasteCategoryRegistry.sol#117-1 |
| Low | timestamp | contracts/core/WasteCategoryRegistry.sol#136 | WasteCategoryRegistry.getCreditsPerKg(uint256) (contracts/core/WasteCategoryRegistry.sol#1 |
| Low | timestamp | contracts/core/WasteCategoryRegistry.sol#110 | WasteCategoryRegistry.deactivate(uint256) (contracts/core/WasteCategoryRegistry.sol#110-11 |
| Low | timestamp | contracts/identity/StakeholderRegistry.sol#153 | StakeholderRegistry.isActive(address) (contracts/identity/StakeholderRegistry.sol#153-155) |
| Informational | pragma | contracts/DAO.sol#2 | 7 different versions of Solidity are used: |
| Informational | solc-version | contracts/DAO.sol#2 | Version constraint ^0.8.20 contains known severe issues (https://solidity.readthedocs.io/e |
| Informational | naming-convention | contracts/DAO.sol#58 | Parameter DAO.addMember(address)._member (contracts/DAO.sol#58) is not in mixedCase |
| Informational | naming-convention | contracts/DAO.sol#65 | Parameter DAO.removeMember(address)._member (contracts/DAO.sol#65) is not in mixedCase |
| Informational | naming-convention | contracts/DAO.sol#137 | Parameter DAO.setVotingPeriod(uint256)._days (contracts/DAO.sol#137) is not in mixedCase |
| Informational | naming-convention | contracts/core/CircularDAO.sol#281 | Function CircularDAO.COUNTING_MODE() (contracts/core/CircularDAO.sol#281-284) is not in mi |
| Informational | naming-convention | contracts/DAO.sol#74 | Parameter DAO.createProposal(string)._description (contracts/DAO.sol#74) is not in mixedCa |
| Informational | naming-convention | contracts/DAO.sol#133 | Parameter DAO.isMember(address)._address (contracts/DAO.sol#133) is not in mixedCase |
| Optimization | cache-array-length | contracts/core/CircularDAO.sol#213 | Loop condition i < allProposalIds.length (contracts/core/CircularDAO.sol#213) should use c |
| Optimization | cache-array-length | contracts/core/CircularDAO.sol#218 | Loop condition i_scope_0 < allProposalIds.length (contracts/core/CircularDAO.sol#218) shou |
| Optimization | constable-states | contracts/core/RecyclingRewards.sol#27 | RecyclingRewards.maxBonusMultiplierBp (contracts/core/RecyclingRewards.sol#27) should be c |
| Optimization | immutable-states | contracts/core/RecyclingRewards.sol#23 | RecyclingRewards.passport (contracts/core/RecyclingRewards.sol#23) should be immutable |
| Optimization | immutable-states | contracts/core/RecyclingRewards.sol#22 | RecyclingRewards.creditToken (contracts/core/RecyclingRewards.sol#22) should be immutable |
| Optimization | immutable-states | contracts/core/CircularDAO.sol#31 | CircularDAO.categoryRegistry (contracts/core/CircularDAO.sol#31) should be immutable |
| Optimization | immutable-states | contracts/core/WasteTracker.sol#21 | WasteTracker.categoryRegistry (contracts/core/WasteTracker.sol#21) should be immutable |
| Optimization | immutable-states | contracts/core/WasteTracker.sol#22 | WasteTracker.passport (contracts/core/WasteTracker.sol#22) should be immutable |
| Optimization | immutable-states | contracts/core/CircularDAO.sol#33 | CircularDAO.stakeholderRegistry (contracts/core/CircularDAO.sol#33) should be immutable |
| Optimization | immutable-states | contracts/core/CircularDAO.sol#32 | CircularDAO.rewardsContract (contracts/core/CircularDAO.sol#32) should be immutable |
| Optimization | immutable-states | contracts/core/WasteTracker.sol#23 | WasteTracker.rewards (contracts/core/WasteTracker.sol#23) should be immutable |
| Optimization | immutable-states | contracts/core/RecyclingRewards.sol#21 | RecyclingRewards.categoryRegistry (contracts/core/RecyclingRewards.sol#21) should be immut |
