# CircularDAO extended governance evaluation — run 2026-09-23T00-37-39-899Z

Evaluated code: commit `21387bcc7b55da0ef89127a9400613d7bb22b2c4` (committed immediately after this run, no code changes in between; `HEAD` was `cec100c` — a prior commit — while the run itself executed, since the C1-C7 fixes and this script were still local, uncommitted changes at that point).
Governor: 0xB72737A3D35c00Afa8e2ff0Ba435eE635Ee66767 · Token: 0x1fe6C81a52033BA4A2db34d82aBfDa77d88eb020 · Registry: 0x329615cE2142A6bae05691144d0bEaEd4c014D6a
Overall result: **ALL CHECKS PASSED**

| Operation | n | Gas (mean) | Gas (min) | Gas (max) | Latency (s, mean) |
|---|---|---|---|---|---|
| proposeAddCategory | 5 | 656,946 | 643,225 | 666,150 | 9.0 |
| execute proposal | 1 | 398,089 | 398,089 | 398,089 | 9.9 |
| attacker self-delegates (post-snapshot) | 1 | 95,691 | 95,691 | 95,691 | 11.6 |
| transfer 20 | 1 | 89,026 | 89,026 | 89,026 | 13.2 |
| vote AGAINST | 6 | 78,175 | 66,243 | 86,534 | 13.7 |
| vote FOR | 8 | 74,834 | 66,284 | 83,384 | 15.6 |
| attacker votes FOR with post-snapshot tokens | 1 | 63,184 | 63,184 | 63,184 | 12.3 |
| execute the defeated proposal (expect revert) | 1 | 55,463 | 55,463 | 55,463 | 20.9 |
| repeated vote | 1 | 38,224 | 38,224 | 38,224 | 24.4 |
| deployer re-grants self ADMIN_ROLE (expect revert) | 1 | 26,338 | 26,338 | 26,338 | 12.7 |
| deployer direct updateCredits (expect revert) | 1 | 23,769 | 23,769 | 23,769 | 11.4 |

Total transactions: 27
Total gas: 5,142,237
Total cost: 0.005571 test ETH
Latency: mean 13.6 s, min 5.5 s, max 35.9 s

## Scenario outcomes (S1-S5)

| Scenario | Final state | Reason | For | Against | Quorum | Valid | Notes |
|---|---|---|---|---|---|---|---|
| S1 | Executed | Executed | 12000 | 4000 | 4000 | yes | PASS: proposal reached Executed (got Executed); PASS: registered category matches the proposed payload field-for-field |
| S2 | Defeated | RejectedByVote | 4000 | 12000 | 4000 | yes | PASS: quorum was met (for+abstain vs quorum: 4000+0 vs 4000); PASS: rejected by vote count, not by quorum (reason=RejectedByVote); PASS: execute() on a defeated proposal reverted (execution reverted) |
| S3 | Defeated | RejectedByQuorum | 1000 | 0 | 4000 | yes | PASS: quorum was NOT met despite unanimous support (reason=RejectedByQuorum); PASS: rejected specifically for quorum, not vote count (reason=RejectedByQuorum) |
| S4 | Defeated | RejectedByQuorum | 0 | 4000 | 4000 | yes | PASS: attacker started from zero weight at the snapshot; PASS: post-snapshot acquisition carried zero voting weight (tally moved by 0) |
| S5 | Defeated | RejectedByVote | 12000 | 63000 | 4000 | yes | PASS: quorum was met by the 3-wallet majority alone (reason=RejectedByVote); PASS: a 3-to-1 wallet majority still lost on token weight (reason=RejectedByVote) |

## S6 — DAO exclusive authority

Valid: **yes**
- PASS: deployer does NOT hold WasteCategoryRegistry.ADMIN_ROLE post-deployment
- PASS: direct updateCredits reverted (execution reverted)
- PASS: self-regrant of ADMIN_ROLE reverted (execution reverted)
- PASS: DAO path already proven working: S1 execute 0x6890c7dbbe4a1eaf7b65bb97a65a72466d4e8113c00e5cf1f467bd6fe655920c
Direct updateCredits attempt: 0x0a9976db73415eedd1bbba5bd1b2a248d9a0a9a7a1ddfdf10170ab8c2b7263d7
Self re-grant ADMIN_ROLE attempt: 0xac8ba1c19cc169a7dbea0bbceee236bb4d24dfdd07d8e00254f9f9cc3bc13322
DAO path evidence (S1 execute): 0x6890c7dbbe4a1eaf7b65bb97a65a72466d4e8113c00e5cf1f467bd6fe655920c