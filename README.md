# Fagundes Odontologia — Automação Editorial

Repositório canônico do código e das regras operacionais da automação editorial da Fagundes Odontologia.

## Estado da baseline

**Baseline:** 2026-10-09  
**Status:** baseline real versionada e integração Meta ↔ Trello implementada em 2026-10-09.

A baseline de produção foi importada antes das alterações funcionais. O código passa a ser mantido no Git e sincronizado com o Apps Script via GitHub Actions + clasp.

## Arquitetura-alvo

```text
Instagram / Meta Graph API
        ↓
Google Apps Script
  ├─ Codigo.gs
  ├─ Editorial.gs
  ├─ SyncTrello.gs
  ├─ Trello.gs
  ├─ Ciclo.gs
  └─ Utils.gs
        ↓
Google Sheets — Fagundes Odontologia — Inteligência Editorial
  ├─ Instagram RAW
  ├─ Insights
  ├─ Snapshots
  ├─ Vínculos Trello
  ├─ Conteúdos
  ├─ Histórico Criativo
  ├─ Editorial
  ├─ Controle Ciclo [planejado]
  └─ Logs Automação
        ↕
Trello — Fagundes Odontologia
  PLANEJAMENTO / CONTEÚDO DO MÊS
        ↓
      POSTAR
        ↓
 Instagram detecta publicação
        ↓
      POSTADOS
        ↓
 Apps Script contabiliza publicação real
        ↓
  ciclo >= 6/8 publicados
        ↓
        READY
        ↓
 executor ChatGPT gera próximo ciclo
```

## Decisão canônica de sincronização

O vínculo entre publicação do Instagram e card do Trello usa como regra principal a igualdade da legenda.

1. A Meta fornece a `caption` publicada.
2. O Apps Script extrai a legenda final do card elegível no Trello.
3. Ambos os textos são normalizados apenas em aspectos técnicos:
   - CRLF/LF;
   - espaços duplicados;
   - espaços no início/fim;
   - normalização Unicode.
4. Palavras, pontuação, emojis, hashtags e CTA permanecem significativos.
5. Match exato e único = `CONFIRMADO_AUTO`.
6. Sem match = nenhuma movimentação de card.
7. Mais de um match = `AMBIGUO`; nenhuma movimentação automática.

Quando houver match único:
- gravar `media_id`, permalink e vínculo Trello;
- mover o card de `POSTAR` para `POSTADOS`;
- marcar o conteúdo como publicado para o controle do ciclo.

O usuário manterá a legenda do Trello atualizada sempre que editar a legenda antes da publicação.

## Gatilho do próximo ciclo

A regra 6/8 não depende de movimentação manual.

`6/8` significa: **seis dos oito cards do ciclo foram confirmados como publicados pela Meta e vinculados aos respectivos cards do Trello**.

O Apps Script é o dono dessa decisão. O executor ChatGPT não deve inferir o gatilho percorrendo listas do Trello.

## Fontes operacionais

- Google Sheets: `Fagundes Odontologia — Inteligência Editorial`
  - ID: `1U5xidLblODRqYg17RUeMUcb47MFzL-mM6CmG7sTOyYA`
- Trello: `Fagundes Odontologia`
  - board object ID: `62fe5d33fdb6558abf2eacc9`
- Estado canônico: `ESTADO ATUAL — FAGUNDES ODONTOLOGIA`

## Segurança

Este repositório é público. Nunca versionar:

- `META_ACCESS_TOKEN`;
- `IG_USER_ID` quando tratado como segredo operacional;
- `TRELLO_API_KEY`;
- `TRELLO_TOKEN`;
- credenciais OAuth;
- conteúdo de Script Properties;
- arquivos locais do `clasp` que contenham credenciais.

Segredos devem permanecer em Script Properties e/ou GitHub Secrets.

## Próximas etapas

1. Configurar `TRELLO_API_KEY` e `TRELLO_TOKEN` em Script Properties.
2. Executar `testarConexaoTrello()`.
3. Executar `diagnosticarSincronizacaoTrello()` e validar resultado sem movimentação.
4. Executar `atualizarControleCiclo()` para inicializar outubro/2026.
5. Validar o primeiro match real Meta → Trello → POSTADOS.
6. Conectar o executor ChatGPT ao estado `READY` do ciclo.
