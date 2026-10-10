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
  GENERATION_LOCK_MINUTES: 240,
  GENERATION_STATUS_PENDING: 'PENDING',
  GENERATION_STATUS_LOCKED: 'LOCKED',
  GENERATION_STATUS_GENERATED: 'GENERATED',
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
  } else if (
    String(estado.summary.cycle_status || '') === 'READY' &&
    String(estado.summary.generation_status || '') ===
      FAGUNDES_CICLO.GENERATION_STATUS_GENERATED
  ) {
    const proximo = detectarCicloMaisNovoTrello_(
      String(estado.summary.current_cycle_id || '')
    );

    if (proximo.cards.length === FAGUNDES_CICLO.TOTAL_ESPERADO) {
      proximo.summary.last_generated_cycle =
        estado.summary.last_generated_cycle || '';
      proximo.summary.last_generated_at =
        estado.summary.last_generated_at || '';
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
      source: 'AUTO',
      generation: estadoGeracaoPadrao_()
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
  const sameCycle =
    normalizarCycleId_(estado.summary.current_cycle_id || '') ===
    normalizarCycleId_(cycleId);

  const generation = sameCycle
    ? normalizarEstadoGeracao_(estado.summary)
    : estadoGeracaoPadrao_({
        lastGeneratedCycle: estado.summary.last_generated_cycle || '',
        lastGeneratedAt: estado.summary.last_generated_at || ''
      });

  escreverControleCiclo_(sheet, {
    cycleId: cycleId,
    cards: refreshed,
    publishedCount: publishedCount,
    status: ready ? 'READY' : 'EM_ANDAMENTO',
    readyAt: readyAt,
    source: estado.summary.source || 'AUTO',
    generation: generation
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
    ready_at: readyAt,
    generation_status: generation.status,
    generation_locked: generation.status === FAGUNDES_CICLO.GENERATION_STATUS_LOCKED,
    generation_lock_expires_at: generation.lockExpiresAt || '',
    last_generated_cycle: generation.lastGeneratedCycle || ''
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

  const summaryValues = sheet.getRange('A1:B17').getValues();

  summaryValues.slice(1).forEach(row => {
    const key = String(row[0] || '').trim();
    if (!key) return;

    summary[key] =
      key === 'current_cycle_id'
        ? normalizarCycleId_(row[1])
        : row[1];
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
      const cycleId = normalizarCycleId_(row[0]);
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


function estadoGeracaoPadrao_(opcoes) {
  opcoes = opcoes || {};

  return {
    status: FAGUNDES_CICLO.GENERATION_STATUS_PENDING,
    lockToken: '',
    lockOwner: '',
    lockAt: '',
    lockExpiresAt: '',
    lastGeneratedCycle: normalizarCycleId_(
      opcoes.lastGeneratedCycle || ''
    ),
    lastGeneratedAt: opcoes.lastGeneratedAt || ''
  };
}

function normalizarEstadoGeracao_(summary) {
  summary = summary || {};

  let status = String(summary.generation_status || '').trim().toUpperCase();
  if (
    status !== FAGUNDES_CICLO.GENERATION_STATUS_PENDING &&
    status !== FAGUNDES_CICLO.GENERATION_STATUS_LOCKED &&
    status !== FAGUNDES_CICLO.GENERATION_STATUS_GENERATED
  ) {
    status = FAGUNDES_CICLO.GENERATION_STATUS_PENDING;
  }

  return {
    status: status,
    lockToken: String(summary.generation_lock || '').trim(),
    lockOwner: String(summary.generation_lock_owner || '').trim(),
    lockAt: summary.generation_lock_at || '',
    lockExpiresAt: summary.generation_lock_expires_at || '',
    lastGeneratedCycle: normalizarCycleId_(
      summary.last_generated_cycle || ''
    ),
    lastGeneratedAt: summary.last_generated_at || ''
  };
}

function lockGeracaoExpirado_(generation, now) {
  if (
    !generation ||
    generation.status !== FAGUNDES_CICLO.GENERATION_STATUS_LOCKED
  ) {
    return false;
  }

  const expires = generation.lockExpiresAt
    ? new Date(generation.lockExpiresAt)
    : null;

  if (!expires || isNaN(expires.getTime())) {
    return true;
  }

  return expires.getTime() <= (now || new Date()).getTime();
}

function lerEstadoGeracaoCiclo() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, FAGUNDES_CICLO.SHEET);
  const estado = lerEstadoCiclo_(sheet);
  const generation = normalizarEstadoGeracao_(estado.summary);
  const now = new Date();
  const expired = lockGeracaoExpirado_(generation, now);

  const result = {
    cycle_id: normalizarCycleId_(
      estado.summary.current_cycle_id || ''
    ),
    next_cycle_id: proximoCycleId_(
      estado.summary.current_cycle_id || ''
    ),
    cycle_status: String(estado.summary.cycle_status || ''),
    published_count: Number(estado.summary.published_count || 0),
    total_cards: Number(estado.summary.total_cards || 0),
    generation_status: generation.status,
    generation_lock_owner: generation.lockOwner,
    generation_lock_at: generation.lockAt,
    generation_lock_expires_at: generation.lockExpiresAt,
    generation_lock_expired: expired,
    last_generated_cycle: generation.lastGeneratedCycle,
    last_generated_at: generation.lastGeneratedAt,
    generation_allowed:
      String(estado.summary.cycle_status || '') === 'READY' &&
      (
        generation.status === FAGUNDES_CICLO.GENERATION_STATUS_PENDING ||
        (
          generation.status === FAGUNDES_CICLO.GENERATION_STATUS_LOCKED &&
          expired
        )
      )
  };

  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Adquire uma lease atômica para gerar o próximo ciclo.
 *
 * owner identifica o executor (ex.: "chatgpt-automation").
 * Retorna acquired=false quando não é seguro gerar.
 */
function adquirirLockGeracaoCiclo(owner) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, FAGUNDES_CICLO.SHEET);
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    return {
      acquired: false,
      reason: 'SCRIPT_LOCK_BUSY'
    };
  }

  try {
    const estado = lerEstadoCiclo_(sheet);
    const cycleId = normalizarCycleId_(
      estado.summary.current_cycle_id || ''
    );
    const cycleStatus = String(
      estado.summary.cycle_status || ''
    ).trim();
    const generation = normalizarEstadoGeracao_(estado.summary);
    const now = new Date();

    if (!cycleId) {
      return {
        acquired: false,
        reason: 'SEM_CICLO'
      };
    }

    if (cycleStatus !== 'READY') {
      return {
        acquired: false,
        reason: 'CICLO_NAO_READY',
        cycle_id: cycleId,
        cycle_status: cycleStatus,
        generation_status: generation.status
      };
    }

    if (
      generation.status === FAGUNDES_CICLO.GENERATION_STATUS_GENERATED
    ) {
      return {
        acquired: false,
        reason: 'JA_GERADO',
        cycle_id: cycleId,
        last_generated_cycle: generation.lastGeneratedCycle
      };
    }

    if (
      generation.status === FAGUNDES_CICLO.GENERATION_STATUS_LOCKED &&
      !lockGeracaoExpirado_(generation, now)
    ) {
      return {
        acquired: false,
        reason: 'LOCK_ATIVO',
        cycle_id: cycleId,
        lock_owner: generation.lockOwner,
        lock_expires_at: generation.lockExpiresAt
      };
    }

    const token = Utilities.getUuid();
    const expiresAt = new Date(
      now.getTime() + FAGUNDES_CICLO.GENERATION_LOCK_MINUTES * 60000
    );

    atualizarCamposResumoCiclo_(sheet, {
      generation_status: FAGUNDES_CICLO.GENERATION_STATUS_LOCKED,
      generation_lock: token,
      generation_lock_owner: String(owner || 'unknown').trim() || 'unknown',
      generation_lock_at: now,
      generation_lock_expires_at: expiresAt,
      updated_at: now
    });

    const result = {
      acquired: true,
      cycle_id: cycleId,
      lock_token: token,
      lock_owner: String(owner || 'unknown').trim() || 'unknown',
      lock_expires_at: expiresAt,
      lease_minutes: FAGUNDES_CICLO.GENERATION_LOCK_MINUTES
    };

    logExecucao_(
      ss,
      'adquirirLockGeracaoCiclo',
      'OK',
      0,
      1,
      'Lock de geração adquirido para ' + cycleId + '.'
    );

    Logger.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Libera uma lease após falha/abort e devolve o ciclo para PENDING.
 * Só o detentor do token pode liberar.
 */
function liberarLockGeracaoCiclo(lockToken, motivo) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, FAGUNDES_CICLO.SHEET);
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    return {
      released: false,
      reason: 'SCRIPT_LOCK_BUSY'
    };
  }

  try {
    const estado = lerEstadoCiclo_(sheet);
    const generation = normalizarEstadoGeracao_(estado.summary);
    const token = String(lockToken || '').trim();

    if (
      generation.status !== FAGUNDES_CICLO.GENERATION_STATUS_LOCKED
    ) {
      return {
        released: false,
        reason: 'SEM_LOCK_ATIVO'
      };
    }

    if (!token || token !== generation.lockToken) {
      return {
        released: false,
        reason: 'LOCK_TOKEN_INVALIDO'
      };
    }

    atualizarCamposResumoCiclo_(sheet, {
      generation_status: FAGUNDES_CICLO.GENERATION_STATUS_PENDING,
      generation_lock: '',
      generation_lock_owner: '',
      generation_lock_at: '',
      generation_lock_expires_at: '',
      updated_at: new Date()
    });

    logExecucao_(
      ss,
      'liberarLockGeracaoCiclo',
      'OK',
      0,
      1,
      'Lock liberado.' + (motivo ? ' Motivo: ' + String(motivo) : '')
    );

    return {
      released: true,
      cycle_id: normalizarCycleId_(
        estado.summary.current_cycle_id || ''
      ),
      generation_status: FAGUNDES_CICLO.GENERATION_STATUS_PENDING
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Confirma que o executor concluiu a criação do próximo ciclo.
 * Só o detentor do token pode concluir.
 */
function marcarGeracaoConcluida(lockToken, generatedCycleId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, FAGUNDES_CICLO.SHEET);
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(10000)) {
    return {
      completed: false,
      reason: 'SCRIPT_LOCK_BUSY'
    };
  }

  try {
    const estado = lerEstadoCiclo_(sheet);
    const generation = normalizarEstadoGeracao_(estado.summary);
    const token = String(lockToken || '').trim();
    const currentCycle = normalizarCycleId_(
      estado.summary.current_cycle_id || ''
    );
    const generatedCycle = normalizarCycleId_(generatedCycleId || '');

    if (
      generation.status === FAGUNDES_CICLO.GENERATION_STATUS_GENERATED
    ) {
      if (
        generatedCycle &&
        generation.lastGeneratedCycle === generatedCycle
      ) {
        return {
          completed: true,
          idempotent: true,
          cycle_id: currentCycle,
          generated_cycle_id: generatedCycle
        };
      }

      return {
        completed: false,
        reason: 'JA_GERADO_COM_OUTRO_CICLO',
        last_generated_cycle: generation.lastGeneratedCycle
      };
    }

    if (
      generation.status !== FAGUNDES_CICLO.GENERATION_STATUS_LOCKED
    ) {
      return {
        completed: false,
        reason: 'SEM_LOCK_ATIVO'
      };
    }

    if (!token || token !== generation.lockToken) {
      return {
        completed: false,
        reason: 'LOCK_TOKEN_INVALIDO'
      };
    }

    if (!generatedCycle || !/^\d{4}-\d{2}$/.test(generatedCycle)) {
      return {
        completed: false,
        reason: 'GENERATED_CYCLE_ID_INVALIDO'
      };
    }

    if (currentCycle && generatedCycle <= currentCycle) {
      return {
        completed: false,
        reason: 'GENERATED_CYCLE_NAO_FUTURO',
        current_cycle_id: currentCycle,
        generated_cycle_id: generatedCycle
      };
    }

    const now = new Date();

    atualizarCamposResumoCiclo_(sheet, {
      generation_status: FAGUNDES_CICLO.GENERATION_STATUS_GENERATED,
      generation_lock: '',
      generation_lock_owner: '',
      generation_lock_at: '',
      generation_lock_expires_at: '',
      last_generated_cycle: generatedCycle,
      last_generated_at: now,
      updated_at: now
    });

    logExecucao_(
      ss,
      'marcarGeracaoConcluida',
      'OK',
      0,
      1,
      'Geração concluída: ' + currentCycle + ' -> ' + generatedCycle + '.'
    );

    const result = {
      completed: true,
      idempotent: false,
      cycle_id: currentCycle,
      generated_cycle_id: generatedCycle,
      generation_status: FAGUNDES_CICLO.GENERATION_STATUS_GENERATED,
      generated_at: now
    };

    Logger.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    lock.releaseLock();
  }
}

function atualizarCamposResumoCiclo_(sheet, fields) {
  if (!sheet) throw new Error('Aba Controle Ciclo não encontrada.');

  const maxRows = 17;
  const range = sheet.getRange(1, 1, maxRows, 2);
  const values = range.getValues();
  const rowByKey = {};

  values.forEach((row, index) => {
    const key = String(row[0] || '').trim();
    if (key) rowByKey[key] = index + 1;
  });

  Object.keys(fields || {}).forEach(key => {
    let row = rowByKey[key];

    if (!row) {
      row = sheet.getLastRow() + 1;
      sheet.getRange(row, 1).setValue(key);
      rowByKey[key] = row;
    }

    if (
      key === 'current_cycle_id' ||
      key === 'last_generated_cycle' ||
      key === 'generation_lock'
    ) {
      sheet.getRange(row, 2).setNumberFormat('@');
    }

    sheet.getRange(row, 2).setValue(fields[key]);
  });
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
      generation_status: FAGUNDES_CICLO.GENERATION_STATUS_PENDING,
      source: 'AUTO'
    },
    cards: selected
  };
}

function proximoCycleId_(cycleId) {
  const current = normalizarCycleId_(cycleId || '');
  const m = current.match(/^(\d{4})-(\d{2})$/);
  if (!m) return '';

  let year = Number(m[1]);
  let month = Number(m[2]) + 1;

  if (month === 13) {
    month = 1;
    year++;
  }

  return year + '-' + String(month).padStart(2, '0');
}

function normalizarCycleId_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(
      value,
      'America/Sao_Paulo',
      'yyyy-MM'
    );
  }

  const text = String(value || '').trim();

  const direct = text.match(/^(\d{4})-(\d{2})$/);
  if (direct) return direct[1] + '-' + direct[2];

  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(
      parsed,
      'America/Sao_Paulo',
      'yyyy-MM'
    );
  }

  return text;
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

  const generation = state.generation || estadoGeracaoPadrao_();

  const summaryRows = [
    FAGUNDES_CICLO.SUMMARY_HEADERS,
    ['current_cycle_id', state.cycleId || ''],
    ['next_cycle_id', proximoCycleId_(state.cycleId || '')],
    ['total_cards', state.cards.length],
    ['published_count', state.publishedCount || 0],
    ['ready_threshold', FAGUNDES_CICLO.READY_THRESHOLD],
    ['cycle_status', state.status || 'SEM_CICLO'],
    ['ready_at', state.readyAt || ''],
    ['generation_status', generation.status || FAGUNDES_CICLO.GENERATION_STATUS_PENDING],
    ['generation_lock', generation.lockToken || ''],
    ['generation_lock_owner', generation.lockOwner || ''],
    ['generation_lock_at', generation.lockAt || ''],
    ['generation_lock_expires_at', generation.lockExpiresAt || ''],
    ['last_generated_cycle', generation.lastGeneratedCycle || ''],
    ['last_generated_at', generation.lastGeneratedAt || ''],
    ['updated_at', new Date()],
    ['source', state.source || 'AUTO']
  ];

  // Impede o Google Sheets de interpretar "2026-10" como uma data.
  sheet.getRange('B2').setNumberFormat('@');
  sheet.getRange('D:D').setNumberFormat('@');

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

  sheet.getRange('B8').setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheet.getRange('B12:B13').setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheet.getRange('B15:B16').setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheet.getRange('B2:B3').setNumberFormat('@');
  sheet.getRange('B9:B11').setNumberFormat('@');
  sheet.getRange('B14').setNumberFormat('@');
  sheet.getRange('H:H').setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheet.getRange('L:L').setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheet.getRange('N:N').setNumberFormat('dd/MM/yyyy HH:mm:ss');
  sheet.setFrozenRows(1);
}
