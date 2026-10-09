# Executor ChatGPT — Fagundes Conteúdo

**Status:** DRAFT — não ativar enquanto o Apps Script não expuser o estado canônico de ciclo.

## Responsabilidade

O executor não decide se o ciclo está pronto.

O Apps Script deve fornecer um estado explícito, como:

```text
cycle_id
cycle_status
published_count
total_count
next_cycle_id
generation_status
```

Somente executar geração quando:

```text
cycle_status = READY
generation_status != GENERATED
```

## Quando READY

1. Ler o estado canônico da Fagundes.
2. Ler a aba `Editorial` e histórico relevante.
3. Validar a barreira de repetição de 60 dias.
4. Gerar exatamente 8 conteúdos do próximo ciclo.
5. Aplicar regras editoriais, SEO Social e segurança clínica.
6. Criar os cards no estágio inicial definido para o fluxo da Fagundes.
7. Verificar idempotência antes de cada escrita.
8. Auditar os 8 cards após criação.
9. Registrar `generation_status = GENERATED` por meio da interface operacional definida.
10. Atualizar o checkpoint somente após criação material ou bloqueio relevante.

## Proibido

- inferir 6/8 pelo simples movimento de cards;
- considerar `POSTAR` como evidência de publicação;
- gerar novo ciclo quando o estado não for `READY`;
- criar cards parciais em estado ambíguo;
- inventar informação clínica;
- usar score neutro/base insuficiente como evidência positiva.

## Observação

O prompt definitivo será ajustado após `Ciclo.gs` e a interface de estado estarem implementados.
