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


## Implementação 2026-10-09

Arquivos ativos:

- `Codigo.gs`: coleta Meta, snapshots, motor editorial e orquestração diária;
- `Trello.gs`: cliente REST do Trello;
- `SyncTrello.gs`: match exato caption Meta × bloco LEGENDA do card;
- `Ciclo.gs`: estado canônico do ciclo 8/8 e gatilho READY em 6/8.

A rotina diária alvo foi implementada como:

```text
coletarInstagram()
capturarSnapshotsInstagram()
sincronizarPublicacoesComTrello()
atualizarMotorEditorial()
atualizarControleCiclo()
```

Se as credenciais Trello não existirem, as duas etapas Trello retornam estado ignorado sem interromper a coleta Meta nem o motor editorial.

### Segurança do match

O match automático exige:

1. legenda normalizada idêntica;
2. match único entre cards elegíveis;
3. ausência de conflito `media_id ↔ card_trello_id`;
4. publicação dentro da janela temporal configurada em relação ao vencimento do card.

Defaults:

- `TRELLO_SYNC_LOOKBACK_DAYS = 60`;
- `TRELLO_MATCH_MAX_DAYS = 21`.

Ambos podem ser sobrescritos via Script Properties.

### Script Properties Trello

Obrigatórios:

- `TRELLO_API_KEY`;
- `TRELLO_TOKEN`.

Opcionais:

- `TRELLO_BOARD_ID`;
- `TRELLO_LIST_PLANEJAMENTO_ID`;
- `TRELLO_LIST_POSTAR_ID`;
- `TRELLO_LIST_POSTADOS_ID`;
- `TRELLO_SYNC_LOOKBACK_DAYS`;
- `TRELLO_MATCH_MAX_DAYS`.

### Controle Ciclo

A aba `Controle Ciclo` é criada automaticamente quando o Trello estiver configurado.

Ela mantém:

- ciclo atual;
- total de cards;
- quantidade publicada;
- limiar 6;
- status `EM_ANDAMENTO` ou `READY`;
- `ready_at`;
- detalhamento dos 8 cards e seus `media_id`.

Um card conta como publicado somente quando existe vínculo confirmado com uma publicação Meta.
