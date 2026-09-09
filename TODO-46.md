# TODO — HANDOFF-46 continuation (atualizado 2026-09-05 ~23:40Z)

Legend: [ ] open · [~] in progress · [x] done

## Storybook capture

- [x] Runs 3/7/8: same-position failure row 18 `observation-fields`, frame sempre correto → readiness flake documentado, não code defect
- [x] Run 6: capture completo 38/38 frames (todos os org flows) — referência boa existe
- [x] Comentário no PR 56 com veredito + evidência (issuecomment-5553830401); decisão (aceitar 17+38 frames / investigar restart da activity / aumentar timeout readiness) pendente do owner — não bloqueia

## Bug 1 — invite accept reject-but-completed (freeze + restart mostra completo)

- [x] Diagnóstico + fix implementado (claude-glm, TDD red→green)
- [x] Reconciliação GATED por provenance (`markAcceptOrigin`/`isAcceptOriginError`) — review Codex REQUEST-CHANGES resolvida
- [x] Testes: preflight errors não reconciliam (identity-mismatch, invalid-local-state); accept-origin reject-but-completed reconcilia

## Bug 2 — org duplicada (create 2x / sem guard)

- [x] Guard `incomplete-org-blocks-create` no fanout + navegação pra Provisioning
- [x] Discard fail-closed com provenance durável (só deleta org criada neste device; TOCTOU revalidation; erros na UI) — Codex re-review resolvida
- [x] Duplicate-org ROOT CAUSE (investigação GPT-6-astra): poda de rotas do navigator cai no initial route original (Success) → segundo create com id novo
- [x] Fix onboarding handoff (`9d9a858`) + completion owner pros 2 entry paths (`6018b18`) — APPROVE-WITH-NITS
- [x] Regression test real-navigator: delayed refresh → Home fica, prompt não volta, exatamente 2 projetos

## Marker overhead (thread P2)

- [x] MARKER_OVERHEAD corrigido p/ 32 + boundary tests 60/61
- [ ] Follow-up (decisão spec): budget do marker pra nomes acentuados (~9-10 letras) — apertado mas correto; alavanca é o budget, não o guard

## PRIMARY GOAL — APK no coiab-app

- [x] Chore PR 58 (build-apk.yml workflow_dispatch) — MERGED, CI verde
- [x] EXPO_TOKEN vs org `transisti` validado (owner fix `617dcf83`)
- [x] APKs builds green: run 33980156982 (pré-fixes), 33993531868, e **definitivo 33996084025** (head `e0dc45e`, tudo incluso)
- [x] Link de download entregue ao usuário

## Pendente (owner decisions / pós-merge)

- [ ] **Merge PR 56** — CLEAN, checks SUCCESS; AGUARDANDO AUTORIZAÇÃO/ação do owner
- [ ] Teste no device do APK definitivo (cenários: onboarding 1x create, segunda org via Home, invite, discard)
- [ ] Follow-up issues pós-merge: redirect runtime org ready→provisioning (thread P1); role collapse em bundle.ts (P2); marker budget acentos; timing tests do completion owner (nit); apagar branch spike do fork se desejado

## Notas

- **REGRA NOVA**: implementação COIAB agora 100% no clone coiab (`/root/dev/coiab-spike-sync` ou worktree da branch alvo). Fork (`spec46-org-layer`) só trabalho upstream CoMapeo. Histórico no fork era meio de transporte; todo código está no coiab (verificado idêntico).
- Implementation via harnesses (claude-glm/codex/claude), nunca edição direta do orchestrator.
- Local jest: só `--runInBand`; `lint:types` precisa `storybook-generate` antes (erro `.rnstorybook/storybook.requires` é pré-existente).
- Push direto ok (regra do owner). Merge exige consentimento explícito.
