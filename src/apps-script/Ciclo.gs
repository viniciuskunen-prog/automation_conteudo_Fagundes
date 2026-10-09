/**
 * Fagundes Odontologia — controle objetivo de ciclos editoriais.
 *
 * READY = pelo menos 6 de 8 cards do ciclo com publicação confirmada
 * por media_id ↔ card_trello_id.
 */

const FAGUNDES_CICLO = {
  SHEET: 'Controle Ciclo',
  TOTAL_ESPERADO: 8,
  READY_THRESHOLD: 6,
  SUMMARY_HEADERS: ['campo', 'valor'],
  DETAIL_HEADERS: [
    'cycle_id',
    'post_num',
    'trello_card_id',
    'card_name',
    'due_date',
    'list_id',
    'media_id',
    'status_publicacao',
    'publicado_em',
    'instagram_permalink',
    'atualizado_em'
  ]
};

function atualizarControleCiclo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (!trelloEstaConfigurado_()) {
    logExecucao_(
      ss,
      'atualizarControleCiclo',
      'OK',
      0,
      0,
      'Trello não configurado; controle de ciclo ignorado.'
    );

    return {
      status: 'IGNORADO',
      motivo: 'TRELLO_NAO_CONFIGURADO'
    };
  }

  const sheet = getOrCreateSheet_(ss, FAGUNDES_CICLO.SHEET);
  const vinculosSheet = getOrCreateSheet_(ss, FAGUNDES_SYNC.SHEET_VINCULOS);
  const vinculos = indexarVinculosTrello_(vinculosSheet);

  let estado = lerEstadoCiclo_(sheet);

  if (!estado.cards.length) {
    estado = detectarCicloInicialTrello_();
  } else if (String(estado.summary.cycle_status || '') === 'READY') {
    const proximo = detectarCicloMaisNovoTrello_(
      String(estado.summary.current_cycle_id || '')
    );

    if (proximo.cards.length === FAGUNDES_CICLO.TOTAL_ESPERADO) {
      estado = proximo;
    }
  }

  if (!estado.cards.length) {
    escreverControleCiclo_(sheet, {
      cycleId: '',
      cards: [],
      publishedCount: 0,
      status: 'SEM_CICLO',
      readyAt: '',
      source: 'AUTO'
    });

    return {
      status: 'SEM_CICLO',
      published_count: 0,
      total_count: 0,
      ready: false
    };
  }

  const refreshed = estado.cards.map(card => {
    let current = card;

    try {
      const live = trelloBuscarCard_(card.cardId);
      if (live) {
        current = {
          cycleId: card.cycleId,
          postNum: card.postNum,
          cardId: String(live.id || card.cardId || ''),
          cardName: String(live.name || card.cardName || ''),
          due: live.due || card.due || '',
          listId: String(live.idList || card.listId || '')
        };
      }
    } catch (_) {
      // O vínculo com a Meta continua sendo a fonte de publicação.
      // Falha de leitura do card não deve zerar o ciclo.
    }

    const link = vinculos.byCard[current.cardId];
    const publicado = Boolean(link && vinculoConfirmado_(link));

    return {
      cycleId: current.cycleId,
      postNum: current.postNum,
      cardId: current.cardId,
      cardName: current.cardName,
      due: current.due,
      listId: current.listId,
      mediaId: publicado ? link.post_id : '',
      statusPublicacao: publicado ? 'PUBLICADO' : 'PENDENTE',
      publicadoEm: publicado ? link.publicado_em || '' : '',
      permalink: publicado ? link.instagram_permalink || '' : ''
    };
  });

  const publishedCount = refreshed.filter(
    card => card.statusPublicacao === 'PUBLICADO'
  ).length;

  const ready =
    refreshed.length === FAGUNDES_CICLO.TOTAL_ESPERADO &&
    publishedCount >= FAGUNDES_CICLO.READY_THRESHOLD;

  const previousReadyAt = estado.summary.ready_at || '';
  const readyAt = ready
    ? previousReadyAt || new Date()
    : '';

  const cycleId = refreshed[0].cycleId || estado.summary.current_cycle_id || '';

  escreverControleCiclo_(sheet, {
    cycleId: cycleId,
    cards: refreshed,
    publishedCount: publishedCount,
    status: ready ? 'READY' : 'EM_ANDAMENTO',
    readyAt: readyAt,
    source: estado.summary.source || 'AUTO'
  });

  logExecucao_(
    ss,
    'atualizarControleCiclo',
    'OK',
    refreshed.length,
    publishedCount,
    [
      'cycle=' + cycleId,
      'publicados=' + publishedCount + '/' + refreshed.length,
      'status=' + (ready ? 'READY' : 'EM_ANDAMENTO')
    ].join(' | ')
  );

  return {
    status: ready ? 'READY' : 'EM_ANDAMENTO',
    cycle_id: cycleId,
    published_count: publishedCount,
    total_count: refreshed.length,
    threshold: FAGUNDES_CICLO.READY_THRESHOLD,
    ready: ready,
    ready_at: readyAt
  };
}

function diagnosticarControleCiclo() {
  const result = atualizarControleCiclo();
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function lerEstadoCiclo_(sheet) {
  const summary = {};
  const cards = [];

  if (sheet.getLastRow() < 2) {
    return { summary: summary, cards: cards };
  }

  const summaryValues = sheet.getRange('A1:B9').getValues();

  summaryValues.slice(1).forEach(row => {
    const key = String(row[0] || '').trim();
    if (key) summary[key] = row[1];
  });

  if (sheet.getLastColumn() >= 14 && sheet.getLastRow() >= 2) {
    const lastDetailRow = sheet.getLastRow();
    const detailValues = sheet
      .getRange(
        2,
        4,
        lastDetailRow - 1,
        FAGUNDES_CICLO.DETAIL_HEADERS.length
      )
      .getValues();

    detailValues.forEach(row => {
      const cycleId = String(row[0] || '').trim();
      const cardId = String(row[2] || '').trim();
      if (!cycleId || !cardId) return;

      cards.push({
        cycleId: cycleId,
        postNum: Number(row[1] || 0),
        cardId: cardId,
        cardName: String(row[3] || ''),
        due: row[4] || '',
        listId: String(row[5] || '')
      });
    });
  }

  return {
    summary: summary,
    cards: cards
  };
}

function detectarCicloInicialTrello_() {
  return detectarCicloMaisNovoTrello_('');
}

function detectarCicloMaisNovoTrello_(afterCycleId) {
  const cards = []
    .concat(trelloListarCardsPlanejamento_())
    .concat(trelloListarCardsPostar_())
    .concat(trelloListarCardsPostados_());

  const groups = {};

  cards.forEach(card => {
    const postNum = extrairNumeroPostCiclo_(card.name);
    const cycleId = cycleIdCardTrello_(card);

    if (!postNum || !cycleId) return;
    if (afterCycleId && cycleId <= afterCycleId) return;

    if (!groups[cycleId]) groups[cycleId] = {};

    if (!groups[cycleId][postNum]) {
      groups[cycleId][postNum] = {
        cycleId: cycleId,
        postNum: postNum,
        cardId: String(card.id || ''),
        cardName: String(card.name || ''),
        due: card.due || '',
        listId: String(card.idList || '')
      };
    }
  });

  const validCycles = Object.keys(groups)
    .filter(cycleId => {
      const slots = groups[cycleId];
      for (let i = 1; i <= FAGUNDES_CICLO.TOTAL_ESPERADO; i++) {
        if (!slots[i]) return false;
      }
      return true;
    })
    .sort();

  if (!validCycles.length) {
    return {
      summary: {
        source: 'AUTO'
      },
      cards: []
    };
  }

  const cycleId = validCycles[validCycles.length - 1];
  const slots = groups[cycleId];

  const selected = [];
  for (let i = 1; i <= FAGUNDES_CICLO.TOTAL_ESPERADO; i++) {
    selected.push(slots[i]);
  }

  return {
    summary: {
      current_cycle_id: cycleId,
      cycle_status: 'EM_ANDAMENTO',
      source: 'AUTO'
    },
    cards: selected
  };
}

function extrairNumeroPostCiclo_(name) {
  const m = String(name || '').match(/^\s*POST\s+0?([1-8])\b/i);
  if (!m) return 0;

  const n = Number(m[1]);
  return n >= 1 && n <= 8 ? n : 0;
}

function cycleIdCardTrello_(card) {
  const due = card && card.due ? new Date(card.due) : null;

  if (due && !isNaN(due.getTime())) {
    return Utilities.formatDate(
      due,
      'America/Sao_Paulo',
      'yyyy-MM'
    );
  }

  const desc = String((card && card.desc) || '').replace(/\r\n?/g, '\n');
  const m = desc.match(
    /(?:^|\n)DATA\s*\n\s*(\d{2})\/(\d{2})\/(\d{4})/i
  );

  if (!m) return '';

  return m[3] + '-' + m[2];
}

function escreverControleCiclo_(sheet, state) {
  sheet.clearContents();

  const summaryRows = [
    FAGUNDES_CICLO.SUMMARY_HEADERS,
    ['current_cycle_id', state.cycleId || ''],
    ['total_cards', state.cards.length],
    ['published_count', state.publishedCount || 0],
    ['ready_threshold', FAGUNDES_CICLO.READY_THRESHOLD],
    ['cycle_status', state.status || 'SEM_CICLO'],
    ['ready_at', state.readyAt || ''],
    ['updated_at', new Date()],
    ['source', state.source || 'AUTO']
  ];

  sheet
    .getRange(1, 1, summaryRows.length, 2)
    .setValues(summaryRows);

  sheet
    .getRange(1, 4, 1, FAGUNDES_CICLO.DETAIL_HEADERS.length)
    .setValues([FAGUNDES_CICLO.DETAIL_HEADERS]);

  // IDs do Instagram excedem a precisão numérica segura do Sheets.
  // Formatar como texto ANTES de escrever evita arredondamento.
  sheet.getRange('F:F').setNumberFormat('@');
  sheet.getRange('I:J').setNumberFormat('@');

  if (state.cards.length) {
    const now = new Date();
    const detailRows = state.cards.map(card => [
      card.cycleId || state.cycleId || '',
      card.postNum || '',
      String(card.cardId || ''),
      card.cardName || '',
      card.due || '',
      String(card.listId || ''),
      String(card.mediaId || ''),
      card.statusPublicacao || 'PENDENTE',
      card.publicadoEm || '',
      card.permalink || '',
      now
    ]);

    sheet
      .getRange(
        2,
        4,
        detailRows.length,
        FAGUNDES_CICLO.DETAIL_HEADERS.length
      )
      .setValues(detailRows);
  }

  sheet.getRange('B7:B8').setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheet.getRange('H:H').setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheet.getRange('L:L').setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheet.getRange('N:N').setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheet.setFrozenRows(1);
}
