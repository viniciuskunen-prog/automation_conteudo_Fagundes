/**
 * Fagundes Odontologia — reconciliação Instagram/Meta ↔ Trello
 *
 * Regra canônica:
 * normalize(Meta.caption) === normalize(Trello.LEGENDA)
 *
 * Não há fuzzy match no fluxo automático.
 */

const FAGUNDES_SYNC = {
  SHEET_VINCULOS: 'Vínculos Trello',
  LOOKBACK_DAYS_DEFAULT: 60,
  MAX_DUE_DISTANCE_DAYS_DEFAULT: 21,
  HEADERS: [
    'post_id',
    'card_trello_id',
    'card_trello_url',
    'confianca_vinculo',
    'status_vinculo',
    'nome_trello_padrao',
    'acao',
    'conflita_com_post_ids',
    'publicado_em',
    'instagram_permalink',
    'origem_vinculo'
  ]
};

function sincronizarPublicacoesComTrello(opcoes) {
  opcoes = opcoes || {};

  const dryRun = opcoes.dryRun === true;
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!trelloEstaConfigurado_()) {
    const result = {
      status: 'IGNORADO',
      motivo: 'TRELLO_NAO_CONFIGURADO',
      dry_run: dryRun,
      matches: []
    };

    logExecucao_(
      ss,
      dryRun
        ? 'diagnosticarSincronizacaoTrello'
        : 'sincronizarPublicacoesComTrello',
      'OK',
      0,
      0,
      'Trello não configurado; sincronização ignorada.'
    );

    return result;
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new Error('Outra execução da sincronização Trello está em andamento.');
  }

  let avaliados = 0;
  let vinculados = 0;
  let movidos = 0;
  let ambiguos = 0;

  try {
    const raw = ss.getSheetByName(FAGUNDES.SHEET_RAW);
    if (!raw || raw.getLastRow() < 2) {
      throw new Error('Instagram RAW está vazio.');
    }

    const vinculosSheet = getOrCreateSheet_(ss, FAGUNDES_SYNC.SHEET_VINCULOS);
    garantirCabecalhoVinculosTrello_(vinculosSheet);

    const cards = trelloListarCardsPostar_();
    const candidatos = [];

    cards.forEach(card => {
      const legenda = extrairLegendaCardTrello_(card.desc || '');
      const normalizada = normalizarLegendaSync_(legenda);

      if (!normalizada) return;

      candidatos.push({
        id: String(card.id || ''),
        name: String(card.name || ''),
        desc: String(card.desc || ''),
        url: String(card.url || card.shortUrl || ''),
        due: card.due || '',
        idList: String(card.idList || ''),
        legenda: legenda,
        legendaNormalizada: normalizada
      });
    });

    const porLegenda = {};
    candidatos.forEach(card => {
      if (!porLegenda[card.legendaNormalizada]) {
        porLegenda[card.legendaNormalizada] = [];
      }
      porLegenda[card.legendaNormalizada].push(card);
    });

    const vinculos = indexarVinculosTrello_(vinculosSheet);

    // Reparo idempotente: vínculo confirmado + card ainda em POSTAR.
    candidatos.forEach(card => {
      const existente = vinculos.byCard[card.id];
      if (!existente || !vinculoConfirmado_(existente)) return;

      if (!dryRun) {
        trelloMoverParaPostados_(card.id);
      }
      movidos++;
    });

    const headers = indexHeaderEtapa8_(
      raw.getRange(1, 1, 1, FAGUNDES.RAW_HEADERS.length).getValues()[0]
    );

    const rows = raw
      .getRange(
        2,
        1,
        raw.getLastRow() - 1,
        FAGUNDES.RAW_HEADERS.length
      )
      .getValues();

    const now = new Date();
    const lookbackDays = getTrelloSyncLookbackDays_();
    const cutoff = new Date(now.getTime() - lookbackDays * 86400000);
    const maxDueDistanceDays = getTrelloMatchMaxDueDistanceDays_();

    const matchesReport = [];

    rows.forEach(row => {
      const postId = String(row[headers.post_id] || '').trim();
      const caption = String(row[headers.descricao] || '');
      const permalink = String(row[headers.permalink] || '');
      const published = toDate_(row[headers.publicado_em]);

      if (!postId || !caption || !published) return;
      if (published < cutoff) return;

      // Já existe vínculo canônico para este media_id.
      if (
        vinculos.byPost[postId] &&
        vinculoConfirmado_(vinculos.byPost[postId])
      ) {
        return;
      }

      avaliados++;

      const captionNormalizada = normalizarLegendaSync_(caption);
      if (!captionNormalizada) return;

      const matches = (porLegenda[captionNormalizada] || []).filter(card => {
        const outro = vinculos.byCard[card.id];
        if (outro && outro.post_id !== postId && vinculoConfirmado_(outro)) {
          return false;
        }

        if (!card.due) return true;

        const due = new Date(card.due);
        if (isNaN(due.getTime())) return true;

        const distancia = Math.abs(published.getTime() - due.getTime()) / 86400000;
        return distancia <= maxDueDistanceDays;
      });

      if (matches.length === 0) return;

      if (matches.length > 1) {
        ambiguos++;
        matchesReport.push({
          post_id: postId,
          status: 'AMBIGUO',
          candidatos: matches.map(card => card.id)
        });
        return;
      }

      const card = matches[0];

      const conflitoPost = vinculos.byPost[postId];
      const conflitoCard = vinculos.byCard[card.id];

      if (
        conflitoPost &&
        conflitoPost.card_trello_id &&
        conflitoPost.card_trello_id !== card.id
      ) {
        matchesReport.push({
          post_id: postId,
          status: 'CONFLITO_POST',
          card_trello_id: card.id
        });
        return;
      }

      if (
        conflitoCard &&
        conflitoCard.post_id &&
        conflitoCard.post_id !== postId
      ) {
        matchesReport.push({
          post_id: postId,
          status: 'CONFLITO_CARD',
          card_trello_id: card.id,
          conflita_com_post_id: conflitoCard.post_id
        });
        return;
      }

      const item = {
        post_id: postId,
        card_trello_id: card.id,
        card_trello_url: card.url,
        confianca_vinculo: 'EXATA',
        status_vinculo: 'CONFIRMADO AUTO',
        nome_trello_padrao: card.name,
        acao: 'VÍNCULO OK',
        conflita_com_post_ids: '',
        publicado_em: published,
        instagram_permalink: permalink,
        origem_vinculo: 'MATCH_LEGENDA_EXATA'
      };

      matchesReport.push({
        post_id: postId,
        status: dryRun ? 'MATCH_DRY_RUN' : 'CONFIRMADO AUTO',
        card_trello_id: card.id,
        card_nome: card.name,
        instagram_permalink: permalink
      });

      if (dryRun) return;

      upsertVinculoTrello_(vinculosSheet, item);
      vinculados++;

      // Atualiza os índices em memória para impedir duplicações na mesma execução.
      vinculos.byPost[postId] = item;
      vinculos.byCard[card.id] = item;

      trelloMoverParaPostados_(card.id);
      movidos++;
    });

    logExecucao_(
      ss,
      dryRun
        ? 'diagnosticarSincronizacaoTrello'
        : 'sincronizarPublicacoesComTrello',
      'OK',
      avaliados,
      vinculados,
      [
        'dryRun=' + dryRun,
        'vinculados=' + vinculados,
        'movidos=' + movidos,
        'ambiguos=' + ambiguos
      ].join(' | ')
    );

    return {
      status: 'OK',
      dry_run: dryRun,
      posts_avaliados: avaliados,
      vinculados: vinculados,
      cards_movidos: movidos,
      ambiguos: ambiguos,
      matches: matchesReport
    };
  } catch (err) {
    try {
      logExecucao_(
        ss,
        dryRun
          ? 'diagnosticarSincronizacaoTrello'
          : 'sincronizarPublicacoesComTrello',
        'ERRO',
        avaliados,
        vinculados,
        err && err.message ? err.message : String(err)
      );
    } catch (_) {}

    throw err;
  } finally {
    lock.releaseLock();
  }
}

function diagnosticarSincronizacaoTrello() {
  const result = sincronizarPublicacoesComTrello({ dryRun: true });
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function extrairLegendaCardTrello_(desc) {
  const text = String(desc || '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');

  let legendaIndex = -1;

  lines.forEach((line, index) => {
    const heading = String(line || '')
      .trim()
      .replace(/:$/, '')
      .toUpperCase();

    if (heading === 'LEGENDA') {
      legendaIndex = index;
    }
  });

  if (legendaIndex < 0) return '';

  const body = [];

  for (let i = legendaIndex + 1; i < lines.length; i++) {
    if (String(lines[i] || '').trim() === '---') break;
    body.push(lines[i]);
  }

  return body.join('\n').trim();
}

function normalizarLegendaSync_(value) {
  let text = String(value || '');

  try {
    text = text.normalize('NFC');
  } catch (_) {}

  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line =>
      String(line || '')
        .replace(/[\t ]+/g, ' ')
        .trim()
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getTrelloSyncLookbackDays_() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('TRELLO_SYNC_LOOKBACK_DAYS');
  const n = raw ? Number(raw) : FAGUNDES_SYNC.LOOKBACK_DAYS_DEFAULT;

  if (!Number.isFinite(n) || n < 1 || n > 365) {
    throw new Error('TRELLO_SYNC_LOOKBACK_DAYS inválido.');
  }

  return Math.floor(n);
}

function getTrelloMatchMaxDueDistanceDays_() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('TRELLO_MATCH_MAX_DAYS');
  const n = raw
    ? Number(raw)
    : FAGUNDES_SYNC.MAX_DUE_DISTANCE_DAYS_DEFAULT;

  if (!Number.isFinite(n) || n < 0 || n > 365) {
    throw new Error('TRELLO_MATCH_MAX_DAYS inválido.');
  }

  return Math.floor(n);
}

function garantirCabecalhoVinculosTrello_(sheet) {
  const headers = FAGUNDES_SYNC.HEADERS;
  const current = sheet
    .getRange(1, 1, 1, headers.length)
    .getValues()[0];

  const mismatch = headers.some((header, index) => current[index] !== header);

  if (mismatch) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  sheet.getRange('A:B').setNumberFormat('@');
  sheet.setFrozenRows(1);
}

function lerVinculosTrello_(sheet) {
  garantirCabecalhoVinculosTrello_(sheet);

  if (sheet.getLastRow() < 2) return [];

  const values = sheet
    .getRange(
      2,
      1,
      sheet.getLastRow() - 1,
      FAGUNDES_SYNC.HEADERS.length
    )
    .getValues();

  return values
    .filter(row => String(row[0] || '').trim())
    .map(row => ({
      post_id: String(row[0] || '').trim(),
      card_trello_id: String(row[1] || '').trim(),
      card_trello_url: String(row[2] || ''),
      confianca_vinculo: String(row[3] || ''),
      status_vinculo: String(row[4] || ''),
      nome_trello_padrao: String(row[5] || ''),
      acao: String(row[6] || ''),
      conflita_com_post_ids: String(row[7] || ''),
      publicado_em: row[8] || '',
      instagram_permalink: String(row[9] || ''),
      origem_vinculo: String(row[10] || '')
    }));
}

function indexarVinculosTrello_(sheet) {
  const rows = lerVinculosTrello_(sheet);
  const byPost = {};
  const byCard = {};

  rows.forEach(item => {
    if (item.post_id) byPost[item.post_id] = item;
    if (item.card_trello_id) byCard[item.card_trello_id] = item;
  });

  return {
    rows: rows,
    byPost: byPost,
    byCard: byCard
  };
}

function vinculoConfirmado_(item) {
  if (!item || !item.card_trello_id) return false;

  const status = String(item.status_vinculo || '').toUpperCase();

  return (
    status === 'CONFIRMADO AUTO' ||
    status === 'CONFIRMADO MANUAL' ||
    status === 'CONFIRMADO ÚNICO' ||
    status === 'CONFIRMADO UNICO'
  );
}

function upsertVinculoTrello_(sheet, item) {
  garantirCabecalhoVinculosTrello_(sheet);

  const values = itemVinculoParaRow_(item);
  const lastRow = sheet.getLastRow();

  if (lastRow >= 2) {
    const ids = sheet
      .getRange(2, 1, lastRow - 1, 1)
      .getValues();

    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0] || '') === String(item.post_id || '')) {
        sheet
          .getRange(i + 2, 1, 1, FAGUNDES_SYNC.HEADERS.length)
          .setValues([values]);
        return i + 2;
      }
    }
  }

  const row = Math.max(sheet.getLastRow() + 1, 2);
  sheet
    .getRange(row, 1, 1, FAGUNDES_SYNC.HEADERS.length)
    .setValues([values]);

  return row;
}

function itemVinculoParaRow_(item) {
  return [
    String(item.post_id || ''),
    String(item.card_trello_id || ''),
    item.card_trello_url || '',
    item.confianca_vinculo || '',
    item.status_vinculo || '',
    item.nome_trello_padrao || '',
    item.acao || '',
    item.conflita_com_post_ids || '',
    item.publicado_em || '',
    item.instagram_permalink || '',
    item.origem_vinculo || ''
  ];
}

/**
 * Usada pelo motor editorial antes de reescrever a aba Vínculos Trello.
 * Preserva somente vínculos que já são seguros.
 */
function lerVinculosPersistentesEtapa8_(sheet) {
  const map = {};

  lerVinculosTrello_(sheet).forEach(item => {
    if (!vinculoConfirmado_(item)) return;

    map[item.post_id] = {
      postId: item.post_id,
      cardId: item.card_trello_id,
      cardUrl: item.card_trello_url,
      confianca: item.confianca_vinculo || 'ALTA',
      status: item.status_vinculo,
      nomePadrao: item.nome_trello_padrao,
      acao: item.acao || 'VÍNCULO OK',
      publicadoEm: item.publicado_em || '',
      permalink: item.instagram_permalink || '',
      origem: item.origem_vinculo || '',
      podeUsar: true
    };
  });

  return map;
}

/**
 * Mescla vínculos persistentes no resultado histórico do motor.
 * Não sobrescreve conflito entre dois cards diferentes.
 */
function mesclarVinculosPersistentesEtapa8_(
  vinculoPorPost,
  vinculoRows,
  persistentes
) {
  const rowIndexByPost = {};
  const cardOwner = {};

  vinculoRows.forEach((row, index) => {
    const postId = String(row[0] || '');
    const cardId = String(row[1] || '');
    if (postId) rowIndexByPost[postId] = index;
    if (cardId && !cardOwner[cardId]) cardOwner[cardId] = postId;

    while (row.length < FAGUNDES_SYNC.HEADERS.length) row.push('');
  });

  Object.keys(persistentes || {}).forEach(postId => {
    const p = persistentes[postId];
    if (!p || !p.cardId) return;

    const atual = vinculoPorPost[postId];

    if (atual && atual.cardId && atual.cardId !== p.cardId) {
      return;
    }

    if (cardOwner[p.cardId] && cardOwner[p.cardId] !== postId) {
      return;
    }

    vinculoPorPost[postId] = p;
    cardOwner[p.cardId] = postId;

    const row = [
      postId,
      p.cardId,
      p.cardUrl || '',
      p.confianca || '',
      p.status || 'CONFIRMADO AUTO',
      p.nomePadrao || '',
      p.acao || 'VÍNCULO OK',
      '',
      p.publicadoEm || '',
      p.permalink || '',
      p.origem || ''
    ];

    if (rowIndexByPost[postId] !== undefined) {
      vinculoRows[rowIndexByPost[postId]] = row;
    } else {
      rowIndexByPost[postId] = vinculoRows.length;
      vinculoRows.push(row);
    }
  });
}
