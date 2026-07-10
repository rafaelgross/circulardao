# Experimento de governança — Sepolia (Seção 6.2)

- Data: 2026-07-10T13:30:25.983Z
- CircularDAO (experimento): [`0x3c8a8950d88ff2D6c30F9d4c1348DC06E2616C12`](https://sepolia.etherscan.io/address/0x3c8a8950d88ff2D6c30F9d4c1348DC06E2616C12)
- GovernanceToken DAOG: [`0x80bFcF2571fbc23E9021825Fe931CC056D0B086b`](https://sepolia.etherscan.io/address/0x80bFcF2571fbc23E9021825Fe931CC056D0B086b)
- WasteCategoryRegistry: [`0x744ac71261622217f872DaE3837830d0AEF55B64`](https://sepolia.etherscan.io/address/0x744ac71261622217f872DaE3837830d0AEF55B64)
- proposalId: `28678232712398802168892972000085376447249598691381107974012903504703221889913`
- Janela de votação: blocos 11243490 → 11243550 (60 blocos ≈ 12 min)
- Estado final: 7 = Executed

## Transações

| # | Operação | Signatário | Bloco | Gás | Preço (gwei) | Custo (ETH) | Latência (s) | Tx |
|---|----------|-----------|-------|-----|--------------|-------------|--------------|----|
| 1 | deploy CircularDAO | deployer | 11243479 | 4.434.799 | 3.67 | 0.016294 | 12.9 | [0x5e126307…](https://sepolia.etherscan.io/tx/0x5e1263075b4cf07b9f705548585c632dcaf9b09b5500025cfa5cbd2912e2d046) |
| 2 | grantRole WasteCategoryRegistry→DAO | deployer | 11243480 | 50.799 | 3.58 | 0.000182 | 10.9 | [0x08f5b87f…](https://sepolia.etherscan.io/tx/0x08f5b87f9df569c85b13fb1a86d89bfb7a249052848a3a7090ba7178ce1c6ddc) |
| 3 | grantRole RecyclingRewards→DAO | deployer | 11243481 | 50.820 | 3.25 | 0.000165 | 11.9 | [0x095011ba…](https://sepolia.etherscan.io/tx/0x095011ba6fd1a8e4780b8da18f8d63f1c22bffcea1c7a4bd6a48a312bf34a3c0) |
| 4 | grantRole StakeholderRegistry→DAO | deployer | 11243482 | 50.793 | 3.45 | 0.000175 | 13.2 | [0xb4d493ae…](https://sepolia.etherscan.io/tx/0xb4d493aeca893d73bde2694b8a9edea44b3bc5f4d3c58ce6eb46a23271c077b5) |
| 5 | financiar votante2 (0.003 ETH) | deployer | 11243483 | 21.000 | 3.40 | 0.000071 | 10.2 | [0x5bc10804…](https://sepolia.etherscan.io/tx/0x5bc10804483608f3138e1d340c8c86d88ddd848f85118d46246baf082414eac3) |
| 6 | financiar votante3 (0.003 ETH) | deployer | 11243484 | 21.000 | 3.40 | 0.000071 | 12.1 | [0xc3d670c9…](https://sepolia.etherscan.io/tx/0xc3d670c9cd59ededbae80521ab30b40e45c16e220e6033a36f85b150ebb815fa) |
| 7 | transferir 20000 DAOG → votante2 | deployer | 11243485 | 89.026 | 3.19 | 0.000284 | 12.4 | [0xf102d0e5…](https://sepolia.etherscan.io/tx/0xf102d0e532902ead83c5d60f4633d0ded697606b51d2a079a7205a98c7292235) |
| 8 | transferir 20000 DAOG → votante3 | deployer | 11243486 | 89.026 | 3.19 | 0.000284 | 11.6 | [0x1cae276e…](https://sepolia.etherscan.io/tx/0x1cae276e591665e062aaa52b671072f0434ec5963c347db7cc5807bf8367a756) |
| 9 | delegate votante2→si mesmo | votante2 | 11243487 | 95.691 | 2.57 | 0.000246 | 13.2 | [0x3d72e7cc…](https://sepolia.etherscan.io/tx/0x3d72e7cca95d2387f9d8f3407346222482834d484fb5d8c60808d79465faf267) |
| 10 | delegate votante3→si mesmo | votante3 | 11243488 | 95.691 | 2.55 | 0.000244 | 11.1 | [0x3c57d353…](https://sepolia.etherscan.io/tx/0x3c57d3537764935892998412c19c3b3cad09698e21310e128c2a8f67e60685ed) |
| 11 | proposeAddCategory Eletrônico de Informática | deployer | 11243489 | 728.487 | 3.07 | 0.002234 | 12.6 | [0x8739f837…](https://sepolia.etherscan.io/tx/0x8739f8377e7b4ef388609e4fdb316ca2add3b76b3d45c475abd8bc055f6a9b73) |
| 12 | castVote deployer (a favor) | deployer | 11243493 | 85.734 | 2.98 | 0.000255 | 8.4 | [0x7b5c1692…](https://sepolia.etherscan.io/tx/0x7b5c1692f2c6b48572a9095247d2a930b03668b285d0f6ce7004a2a163fa1f2f) |
| 13 | castVote votante2 (a favor) | votante2 | 11243494 | 66.284 | 2.40 | 0.000159 | 10.3 | [0xdc582960…](https://sepolia.etherscan.io/tx/0xdc5829600a57ee4e8ca3caca9499bc689213d5805a72b868c1c999a38bfbae18) |
| 14 | castVote votante3 (contra) | votante3 | 11243495 | 83.343 | 2.43 | 0.000203 | 11.5 | [0x987c61eb…](https://sepolia.etherscan.io/tx/0x987c61eb77ae8061b3558b25b32e85b437e80a93c794bedede67480f654f54b2) |
| 15 | execute proposta | deployer | 11243552 | 397.933 | 1.39 | 0.000552 | 6.8 | [0xdbb705f9…](https://sepolia.etherscan.io/tx/0xdbb705f9b42d0976083fd91a0257c14dd1102764c6183614fda9a7aebc8ab8a9) |

**Totais:** 6.360.426 gás | 0.021420 ETH | latência média 11.3 s (min 6.8, máx 13.2)

## Custo por operação do ciclo de governança (dados para a Tabela da Seção 6.2)

| Operação | Gás | Custo Sepolia (ETH) |
|----------|-----|---------------------|
| deploy CircularDAO | 4.434.799 | 0.016294 |
| proposeAddCategory Eletrônico de Informática | 728.487 | 0.002234 |
| castVote deployer (a favor) | 85.734 | 0.000255 |
| castVote votante2 (a favor) | 66.284 | 0.000159 |
| castVote votante3 (contra) | 83.343 | 0.000203 |
| execute proposta | 397.933 | 0.000552 |

Obs.: custo estimado na Polygon PoS = gás × preço médio de gás da Polygon (~30 gwei) × preço do POL — recalcular na data da submissão.
