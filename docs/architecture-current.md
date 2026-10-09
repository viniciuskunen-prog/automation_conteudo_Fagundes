# Arquitetura atual e alvo — 2026-10-09

## Estado confirmado

A Fagundes já possui um sistema operacional em produção com:

- coleta Meta/Instagram via Apps Script;
- histórico desde 2026-01-01;
- janela recorrente de atualização de 45 dias;
- snapshots;
- motor editorial;
- trigger diário na janela das 06h;
- planilha de inteligência editorial;
- integração operacional com Trello ainda incompleta.

A planilha operacional é `Fagundes Odontologia — Inteligência Editorial`.

Abas confirmadas:

- Conteúdos
- Vínculos Trello
- Insights
- Snapshots
- Editorial
- Histórico Criativo
- Importação 2026
- Instagram RAW
- Configuração
- Logs Automação

## Trello

Board: `Fagundes Odontologia`

Fluxo atual:

```text
PLANEJAMENTO / CONTEÚDO DO MÊS
          ↓
        POSTAR
          ↓
        POSTADOS
```

Também existe `banco de posts`, que pode ser usado como estoque editorial, mas não será usado como substituto da evidência real de publicação.

## Responsabilidade por camada

### Apps Script

É o escritor canônico para:

- coleta Meta;
- snapshots;
- sincronização de publicação com Trello;
- atualização da camada Editorial;
- estado dos ciclos;
- decisão `READY / NOT_READY`;
- logs operacionais.

### Google Sheets

É a fonte de estado operacional e histórico.

### Trello

É a interface de produção, não a fonte exclusiva da verdade sobre publicação.

### Meta / Instagram

É a evidência canônica de que um conteúdo foi efetivamente publicado.

### ChatGPT

É executor criativo. Só cria novo ciclo quando o Apps Script disponibilizar estado `READY`.

## Sincronização publicada

A sincronização deve usar `caption Meta = legenda Trello`, após normalização técnica.

Não usar análise semântica no fluxo normal.

Estados previstos:

- `CONFIRMADO_AUTO`
- `CONFIRMADO_MANUAL`
- `AMBIGUO`
- `SEM_MATCH`
- `ORGANICO_SEM_CARD`

Um match automático só pode existir quando for único.

## Gatilho 6/8

A definição canônica de “publicado” é:

1. publicação encontrada na Meta;
2. caption corresponde exatamente a um card do ciclo;
3. vínculo `media_id ↔ trello_card_id` foi registrado.

A movimentação manual no Trello não participa do cálculo.

Quando 6 dos 8 conteúdos do ciclo atenderem aos três critérios:

```text
cycle_status = READY
published_count = 6
total_count = 8
```

O executor pode então iniciar o próximo ciclo, sujeito à trava de idempotência.

## Idempotência

O sistema deve impedir:

- mais de um `media_id` para o mesmo card;
- mais de um card para o mesmo `media_id`;
- criação duplicada do mesmo ciclo;
- nova geração enquanto já existir ciclo futuro aberto/completo.

## Ordem diária alvo

```text
rotinaDiariaFagundes()
  1. coletarInstagram()
  2. capturarSnapshotsInstagram()
  3. sincronizarPublicacoesComTrello()
  4. atualizarMotorEditorial()
  5. atualizarEstadoCiclo()
  6. registrarLog()
```

O nome exato das funções existentes em produção deve ser preservado ou migrado explicitamente após a exportação do código real.
