# Fagundes Odontologia — Automação Editorial

Repositório canônico do código e das regras operacionais da automação editorial da Fagundes Odontologia.

## Estado da baseline

**Baseline:** 2026-10-09  
**Status:** arquitetura definida; código Apps Script real em produção ainda não foi exportado/versionado neste repositório.

Este repositório não deve receber código reconstruído por suposição. A primeira versão dos arquivos Apps Script deve vir do projeto real atualmente em produção.

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

1. Exportar o Apps Script real da Fagundes.
2. Commitar a baseline real sem alterações funcionais.
3. Auditar o código em produção contra a arquitetura documentada.
4. Implementar sincronização determinística Meta ↔ Trello.
5. Implementar controle de ciclo 6/8 baseado em publicação real.
6. Testar end-to-end sem movimentação destrutiva.
7. Configurar `clasp` e GitHub Actions para deploy controlado.
