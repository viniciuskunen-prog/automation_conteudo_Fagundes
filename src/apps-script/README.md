# Apps Script — Fagundes

Esta pasta deve conter a fonte real do projeto Apps Script em produção.

## Regra de baseline

Não reconstruir o código atual a partir de memória, logs ou da automação da HeliteHome.

A primeira importação deve ser obtida diretamente do projeto Apps Script da Fagundes.

Arquivos-alvo previstos:

```text
Codigo.gs
Editorial.gs
SyncTrello.gs
Trello.gs
Ciclo.gs
Utils.gs
appsscript.json
```

Os nomes reais existentes em produção têm precedência na primeira importação.

## Alterações planejadas após a baseline real

1. preservar coleta Meta e snapshots que já funcionam;
2. corrigir consumo dos vínculos confirmados pelo motor Editorial;
3. implementar match determinístico por legenda;
4. movimentar automaticamente `POSTAR → POSTADOS`;
5. criar controle de ciclo baseado em publicações reais;
6. expor estado `READY / NOT_READY`;
7. adicionar idempotência e recuperação de falha parcial;
8. somente depois configurar deploy automático.
