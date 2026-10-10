/**

 * Fagundes Odontologia — Inteligência Editorial

 * Etapa 5 — Coleta Meta / Instagram

 *

 * Requisitos em Script Properties:

 * - META_ACCESS_TOKEN

 * - IG_USER_ID

 * - META_API_VERSION (opcional; default v26.0)

 * - HISTORY_START (opcional; default 2026-01-01)

 * - REFRESH_DAYS (opcional; default 45)

 *

 * Planilha:

 * Fagundes Odontologia — Inteligência Editorial

 */



const FAGUNDES = {

  SHEET_RAW: 'Instagram RAW',

  SHEET_LOGS: 'Logs Automação',

  DEFAULT_API_VERSION: 'v26.0',

  DEFAULT_HISTORY_START: '2026-01-01',

  DEFAULT_REFRESH_DAYS: 45,

  SNAPSHOT_ELIGIBLE_FROM: '2026-08-29',

  SNAPSHOT_STAGES: [7, 14, 30],

  SHEET_SNAPSHOTS: 'Snapshots',

  RAW_HEADERS: [

    'post_id',

    'publicado_em',

    'permalink',

    'formato',

    'descricao',

    'visualizacoes',

    'alcance',

    'curtidas',

    'compartilhamentos',

    'comentarios',

    'salvamentos',

    'media_product_type',

    'coletado_em'

  ]

};



/**

 * Primeira carga completa do histórico definido em HISTORY_START.

 * Execute manualmente uma única vez após configurar as credenciais.

 */

function coletaInicialInstagram() {

  return executarColetaInstagram_({

    modo: 'INICIAL',

    desde: getHistoryStart_()

  });

}



/**

 * Rotina recorrente.

 * Descobre novos posts e atualiza métricas dos conteúdos recentes.

 * Esta será ligada ao trigger na Etapa 7.

 */

function coletarInstagram() {

  const refreshDays = getRefreshDays_();

  const desde = new Date();

  desde.setDate(desde.getDate() - refreshDays);



  return executarColetaInstagram_({

    modo: 'RECORRENTE',

    desde: desde

  });

}



/**

 * Teste simples de credenciais/conectividade.

 * Não escreve métricas; apenas valida o acesso à conta.

 */

function testarConexaoMeta() {

  const cfg = getConfig_();

  const url = graphUrl_(cfg.version, cfg.igUserId, {

    fields: 'id,username,name',

    access_token: cfg.token

  });



  const data = fetchJson_(url);

  Logger.log(JSON.stringify(data, null, 2));

  return data;

}



function executarColetaInstagram_(opcoes) {

  const lock = LockService.getScriptLock();

  if (!lock.tryLock(5000)) {

    throw new Error('Outra execução da coleta já está em andamento.');

  }



  const startedAt = new Date();

  let lidos = 0;

  let atualizados = 0;



  try {

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    const raw = getOrCreateSheet_(ss, FAGUNDES.SHEET_RAW);

    ensureHeaders_(raw, FAGUNDES.RAW_HEADERS);

    raw.getRange('A:A').setNumberFormat('@');



    const cfg = getConfig_();

    const existentes = buildExistingMap_(raw);

    const medias = listarMidias_(cfg, opcoes.desde);



    lidos = medias.length;



    const rows = [];

    const coletadoEm = new Date();



    medias.forEach(media => {

      const metrics = buscarMetricasMidia_(cfg, media.id);



      rows.push([

        String(media.id || ''),

        parseMetaDate_(media.timestamp),

        media.permalink || '',

        normalizarFormato_(media.media_type, media.media_product_type),

        media.caption || '',

        numberOrBlank_(metrics.views),

        numberOrBlank_(metrics.reach),

        numberOrBlank_(media.like_count),

        numberOrBlank_(metrics.shares),

        numberOrBlank_(media.comments_count),

        numberOrBlank_(metrics.saved),

        media.media_product_type || '',

        coletadoEm

      ]);

    });



    atualizados = upsertRowsById_(raw, rows, existentes);



    logExecucao_(

      ss,

      opcoes.modo === 'INICIAL' ? 'coletaInicialInstagram' : 'coletarInstagram',

      'OK',

      lidos,

      atualizados,

      'Coleta concluída.'

    );



    return {

      modo: opcoes.modo,

      lidos: lidos,

      atualizados: atualizados,

      iniciado_em: startedAt,

      concluido_em: new Date()

    };



  } catch (err) {

    try {

      logExecucao_(

        SpreadsheetApp.getActiveSpreadsheet(),

        opcoes.modo === 'INICIAL' ? 'coletaInicialInstagram' : 'coletarInstagram',

        'ERRO',

        lidos,

        atualizados,

        err && err.message ? err.message : String(err)

      );

    } catch (_) {}



    throw err;

  } finally {

    lock.releaseLock();

  }

}



function listarMidias_(cfg, desde) {

  const fields = [

    'id',

    'caption',

    'media_type',

    'media_product_type',

    'permalink',

    'timestamp',

    'like_count',

    'comments_count'

  ].join(',');



  let url = graphUrl_(cfg.version, cfg.igUserId + '/media', {

    fields: fields,

    limit: 100,

    access_token: cfg.token

  });



  const result = [];

  const cutoff = startOfDay_(desde);



  while (url) {

    const page = fetchJson_(url);

    const data = Array.isArray(page.data) ? page.data : [];



    let atingiuCorte = false;



    for (const media of data) {

      const published = parseMetaDate_(media.timestamp);

      if (published && published < cutoff) {

        atingiuCorte = true;

        continue;

      }

      result.push(media);

    }



    if (atingiuCorte) break;

    url = page.paging && page.paging.next ? page.paging.next : null;

  }



  return result;

}



/**

 * Faz uma chamada conjunta para as métricas principais.

 * Se a combinação não for aceita para determinado tipo de mídia,

 * cai para consultas individuais para não abortar a coleta inteira.

 */

function buscarMetricasMidia_(cfg, mediaId) {

  const wanted = ['views', 'reach', 'saved', 'shares'];

  const metrics = {};



  const url = graphUrl_(cfg.version, mediaId + '/insights', {

    metric: wanted.join(','),

    access_token: cfg.token

  });



  try {

    const payload = fetchJson_(url);

    mergeInsights_(metrics, payload);

    return metrics;

  } catch (err) {

    wanted.forEach(metric => {

      try {

        const singleUrl = graphUrl_(cfg.version, mediaId + '/insights', {

          metric: metric,

          access_token: cfg.token

        });

        const payload = fetchJson_(singleUrl);

        mergeInsights_(metrics, payload);

      } catch (_) {

        // Métrica indisponível para aquele formato/API.

        // Mantemos vazio em vez de interromper a coleta.

      }

    });

    return metrics;

  }

}



function mergeInsights_(target, payload) {

  const items = payload && Array.isArray(payload.data) ? payload.data : [];



  items.forEach(item => {

    const name = item.name;

    if (!name) return;



    let value = null;



    if (Array.isArray(item.values) && item.values.length) {

      const last = item.values[item.values.length - 1];

      value = last && last.value !== undefined ? last.value : null;

    } else if (item.value !== undefined) {

      value = item.value;

    } else if (

      item.total_value &&

      item.total_value.value !== undefined

    ) {

      value = item.total_value.value;

    }



    if (value !== null && value !== undefined && value !== '') {

      target[name] = Number(value);

    }

  });

}



function upsertRowsById_(sheet, incomingRows, existingMap) {

  if (!incomingRows.length) return 0;



  let changed = 0;

  const appendRows = [];



  incomingRows.forEach(row => {

    const id = String(row[0]);



    if (existingMap.has(id)) {

      const rowNumber = existingMap.get(id);

      sheet.getRange(rowNumber, 1, 1, FAGUNDES.RAW_HEADERS.length)

        .setValues([row]);

      changed++;

    } else {

      appendRows.push(row);

    }

  });



  if (appendRows.length) {

    const start = Math.max(sheet.getLastRow() + 1, 2);

    sheet.getRange(start, 1, appendRows.length, FAGUNDES.RAW_HEADERS.length)

      .setValues(appendRows);

    changed += appendRows.length;

  }



  formatRawSheet_(sheet);

  return changed;

}



function buildExistingMap_(sheet) {

  const map = new Map();

  const lastRow = sheet.getLastRow();



  if (lastRow < 2) return map;



  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();



  ids.forEach((row, i) => {

    if (row[0] !== '' && row[0] !== null) {

      map.set(String(row[0]), i + 2);

    }

  });



  return map;

}



function ensureHeaders_(sheet, headers) {

  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];

  const mismatch = headers.some((h, i) => current[i] !== h);



  if (mismatch) {

    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  }



  sheet.setFrozenRows(1);

}



function formatRawSheet_(sheet) {

  sheet.getRange('A:A').setNumberFormat('@');

  sheet.getRange('B:B').setNumberFormat('dd/MM/yyyy HH:mm:ss');

  sheet.getRange('F:K').setNumberFormat('0');

  sheet.getRange('M:M').setNumberFormat('dd/MM/yyyy HH:mm:ss');

}



function logExecucao_(ss, funcao, status, lidos, atualizados, mensagem) {

  const sheet = getOrCreateSheet_(ss, FAGUNDES.SHEET_LOGS);



  if (sheet.getLastRow() === 0) {

    sheet.appendRow([

      'executado_em',

      'funcao',

      'status',

      'posts_lidos',

      'posts_atualizados',

      'mensagem'

    ]);

  }



  sheet.appendRow([

    new Date(),

    funcao,

    status,

    lidos,

    atualizados,

    String(mensagem || '').slice(0, 1000)

  ]);



  sheet.getRange('A:A').setNumberFormat('dd/MM/yyyy HH:mm:ss');

}



function getConfig_() {

  const props = PropertiesService.getScriptProperties();



  const token = props.getProperty('META_ACCESS_TOKEN');

  const igUserId = props.getProperty('IG_USER_ID');

  const version = props.getProperty('META_API_VERSION') || FAGUNDES.DEFAULT_API_VERSION;



  if (!token) {

    throw new Error('META_ACCESS_TOKEN não configurado em Script Properties.');

  }

  if (!igUserId) {

    throw new Error('IG_USER_ID não configurado em Script Properties.');

  }



  return {

    token: token,

    igUserId: igUserId,

    version: version

  };

}



function getHistoryStart_() {

  const value = PropertiesService.getScriptProperties()

    .getProperty('HISTORY_START') || FAGUNDES.DEFAULT_HISTORY_START;



  const d = new Date(value + 'T00:00:00');

  if (isNaN(d.getTime())) {

    throw new Error('HISTORY_START inválido. Use YYYY-MM-DD.');

  }

  return d;

}



function getRefreshDays_() {

  const raw = PropertiesService.getScriptProperties()

    .getProperty('REFRESH_DAYS');



  const n = raw ? Number(raw) : FAGUNDES.DEFAULT_REFRESH_DAYS;



  if (!Number.isFinite(n) || n < 1 || n > 365) {

    throw new Error('REFRESH_DAYS inválido.');

  }

  return Math.floor(n);

}



function graphUrl_(version, path, params) {

  const base = 'https://graph.facebook.com/' +

    encodeURIComponent(version) + '/' + path;



  const query = Object.keys(params)

    .filter(key => params[key] !== null && params[key] !== undefined)

    .map(key => encodeURIComponent(key) + '=' + encodeURIComponent(params[key]))

    .join('&');



  return base + '?' + query;

}



function fetchJson_(url) {

  const response = UrlFetchApp.fetch(url, {

    muteHttpExceptions: true,

    followRedirects: true

  });



  const code = response.getResponseCode();

  const text = response.getContentText();



  let payload;

  try {

    payload = JSON.parse(text);

  } catch (_) {

    throw new Error('Resposta não JSON da Meta. HTTP ' + code);

  }



  if (code < 200 || code >= 300 || payload.error) {

    const apiMessage = payload &&

      payload.error &&

      payload.error.message

      ? payload.error.message

      : 'Erro desconhecido';



    throw new Error(

      'Meta API HTTP ' + code + ': ' + apiMessage

    );

  }



  return payload;

}



function normalizarFormato_(mediaType, mediaProductType) {

  const type = String(mediaType || '').toUpperCase();

  const product = String(mediaProductType || '').toUpperCase();



  if (product === 'REELS' || type === 'VIDEO') return 'Reel';

  if (type === 'CAROUSEL_ALBUM') return 'Carrossel';

  return 'Imagem';

}



function parseMetaDate_(value) {

  if (!value) return '';

  const d = new Date(value);

  return isNaN(d.getTime()) ? '' : d;

}



function numberOrBlank_(value) {

  return value === null || value === undefined || value === ''

    ? ''

    : Number(value);

}



function startOfDay_(date) {

  const d = new Date(date);

  d.setHours(0, 0, 0, 0);

  return d;

}







/**

 * ETAPA 6 — SNAPSHOTS 7 / 14 / 30 DIAS

 *

 * Regra canônica:

 * - snapshot é imutável;

 * - chave = post_id:snapshot_dias;

 * - não cria snapshots históricos fictícios;

 * - só aceita posts publicados a partir de SNAPSHOT_ELIGIBLE_FROM;

 * - registra idade real e eventual atraso de captura.

 *

 * Esta função ainda é executada manualmente.

 * O trigger será criado somente na Etapa 7.

 */

function capturarSnapshotsInstagram() {

  const lock = LockService.getScriptLock();

  if (!lock.tryLock(5000)) {

    throw new Error('Outra execução da automação já está em andamento.');

  }



  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let avaliados = 0;

  let criados = 0;



  try {

    const raw = ss.getSheetByName(FAGUNDES.SHEET_RAW);

    if (!raw || raw.getLastRow() < 2) {

      throw new Error('Instagram RAW está vazio. Execute a coleta antes dos snapshots.');

    }



    const snapshots = getOrCreateSheet_(ss, FAGUNDES.SHEET_SNAPSHOTS);

    ensureSnapshotHeaders_(snapshots);



    snapshots.getRange('A:C').setNumberFormat('@');



    const cfg = getConfig_();

    const now = new Date();

    const eligibleFrom = new Date(

      FAGUNDES.SNAPSHOT_ELIGIBLE_FROM + 'T00:00:00'

    );



    const lastRow = raw.getLastRow();

    const rawRows = raw

      .getRange(2, 1, lastRow - 1, FAGUNDES.RAW_HEADERS.length)

      .getValues();



    const existing = buildSnapshotKeySet_(snapshots);

    const toAppend = [];



    rawRows.forEach(row => {

      const postId = String(row[0] || '').trim();

      const published = toDate_(row[1]);



      if (!postId || !published) return;

      if (published < eligibleFrom) return;



      avaliados++;



      const ageDays = completedDays_(published, now);



      FAGUNDES.SNAPSHOT_STAGES.forEach(stage => {

        if (ageDays < stage) return;



        const key = postId + ':' + stage;

        if (existing.has(key)) return;



        const media = buscarMidiaBasica_(cfg, postId);

        const metrics = buscarMetricasMidia_(cfg, postId);

        const delay = Math.max(0, ageDays - stage);



        toAppend.push([

          key,

          postId,

          published,

          stage,

          ageDays,

          delay,

          now,

          normalizarFormato_(

            media.media_type,

            media.media_product_type

          ),

          numberOrBlank_(metrics.views),

          numberOrBlank_(metrics.reach),

          numberOrBlank_(media.like_count),

          numberOrBlank_(metrics.shares),

          numberOrBlank_(media.comments_count),

          numberOrBlank_(metrics.saved),

          'Meta Graph API',

          delay === 0 ? 'NO PRAZO' : 'ATRASADO +' + delay + 'd'

        ]);



        existing.add(key);

      });

    });



    if (toAppend.length) {

      const start = Math.max(snapshots.getLastRow() + 1, 2);

      snapshots

        .getRange(start, 1, toAppend.length, 16)

        .setValues(toAppend);



      formatSnapshotSheet_(snapshots);

      criados = toAppend.length;

    }



    logExecucao_(

      ss,

      'capturarSnapshotsInstagram',

      'OK',

      avaliados,

      criados,

      criados + ' snapshot(s) criado(s).'

    );



    return {

      posts_elegiveis_avaliados: avaliados,

      snapshots_criados: criados,

      elegivel_desde: FAGUNDES.SNAPSHOT_ELIGIBLE_FROM,

      estagios: FAGUNDES.SNAPSHOT_STAGES

    };



  } catch (err) {

    try {

      logExecucao_(

        ss,

        'capturarSnapshotsInstagram',

        'ERRO',

        avaliados,

        criados,

        err && err.message ? err.message : String(err)

      );

    } catch (_) {}



    throw err;

  } finally {

    lock.releaseLock();

  }

}



/**

 * Diagnóstico sem escrita.

 * Mostra quais posts recentes estão aguardando 7, 14 ou 30 dias.

 */

function diagnosticarSnapshots() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const raw = ss.getSheetByName(FAGUNDES.SHEET_RAW);

  const snapshots = ss.getSheetByName(FAGUNDES.SHEET_SNAPSHOTS);



  if (!raw || raw.getLastRow() < 2) {

    throw new Error('Instagram RAW está vazio.');

  }



  const eligibleFrom = new Date(

    FAGUNDES.SNAPSHOT_ELIGIBLE_FROM + 'T00:00:00'

  );

  const now = new Date();

  const existing = snapshots

    ? buildSnapshotKeySet_(snapshots)

    : new Set();



  const rows = raw

    .getRange(2, 1, raw.getLastRow() - 1, FAGUNDES.RAW_HEADERS.length)

    .getValues();



  const result = [];



  rows.forEach(row => {

    const postId = String(row[0] || '').trim();

    const published = toDate_(row[1]);

    if (!postId || !published || published < eligibleFrom) return;



    const age = completedDays_(published, now);



    FAGUNDES.SNAPSHOT_STAGES.forEach(stage => {

      const key = postId + ':' + stage;

      if (existing.has(key)) return;



      result.push({

        post_id: postId,

        publicado_em: published,

        snapshot_dias: stage,

        idade_atual_dias: age,

        faltam_dias: Math.max(0, stage - age),

        pronto_agora: age >= stage

      });

    });

  });



  result.sort((a, b) =>

    a.faltam_dias - b.faltam_dias ||

    a.snapshot_dias - b.snapshot_dias

  );



  Logger.log(JSON.stringify(result, null, 2));

  return result;

}



function buscarMidiaBasica_(cfg, mediaId) {

  const url = graphUrl_(cfg.version, mediaId, {

    fields: [

      'id',

      'timestamp',

      'media_type',

      'media_product_type',

      'like_count',

      'comments_count'

    ].join(','),

    access_token: cfg.token

  });



  return fetchJson_(url);

}



function ensureSnapshotHeaders_(sheet) {

  const headers = [

    'snapshot_key',

    'post_id',

    'publicado_em',

    'snapshot_dias',

    'idade_real_dias',

    'atraso_dias',

    'capturado_em',

    'formato',

    'visualizacoes',

    'alcance',

    'curtidas',

    'compartilhamentos',

    'comentarios',

    'salvamentos',

    'origem',

    'status_snapshot'

  ];



  const current = sheet

    .getRange(1, 1, 1, headers.length)

    .getValues()[0];



  const mismatch = headers.some((h, i) => current[i] !== h);



  if (mismatch) {

    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  }



  sheet.setFrozenRows(1);

}



function buildSnapshotKeySet_(sheet) {

  const set = new Set();

  const lastRow = sheet.getLastRow();



  if (lastRow < 2) return set;



  const values = sheet

    .getRange(2, 1, lastRow - 1, 1)

    .getValues();



  values.forEach(row => {

    if (row[0] !== '' && row[0] !== null) {

      set.add(String(row[0]));

    }

  });



  return set;

}



function formatSnapshotSheet_(sheet) {

  sheet.getRange('A:C').setNumberFormat('@');

  sheet.getRange('C:C').setNumberFormat('dd/MM/yyyy HH:mm:ss');

  sheet.getRange('G:G').setNumberFormat('dd/MM/yyyy HH:mm:ss');

  sheet.getRange('D:F').setNumberFormat('0');

  sheet.getRange('I:N').setNumberFormat('0');

}



function completedDays_(from, to) {

  const ms = to.getTime() - from.getTime();

  return Math.floor(ms / 86400000);

}



function toDate_(value) {

  if (value instanceof Date && !isNaN(value.getTime())) {

    return value;

  }



  if (!value) return null;



  // Datas já gravadas pelo Apps Script normalmente chegam como Date.

  // Fallback para strings ISO / reconhecidas pelo JavaScript.

  const d = new Date(value);

  return isNaN(d.getTime()) ? null : d;

}



/**

 * Rotina completa prevista para a Etapa 7.

 * NÃO crie trigger ainda.

 */

function rotinaDiariaFagundes() {

  coletarInstagram();

  Utilities.sleep(1000);

  capturarSnapshotsInstagram();

  Utilities.sleep(500);

  // A publicação real na Meta é a fonte da verdade operacional.
  // Sem credenciais Trello, a sincronização registra IGNORADO e a rotina continua.
  sincronizarPublicacoesComTrello();

  Utilities.sleep(300);

  atualizarMotorEditorial();

  Utilities.sleep(300);

  const cycleState = atualizarControleCiclo();

  // Reserva atomicamente a geração para o executor ChatGPT quando 6/8
  // publicações reais tornam o ciclo READY.
  if (cycleState && cycleState.status === 'READY') {
    adquirirLockGeracaoCiclo('chatgpt-automation');
  }

}







/**

 * ETAPA 7 — ATUALIZAÇÃO RECORRENTE

 *

 * Cria exatamente um trigger diário para rotinaDiariaFagundes().

 * Apps Script não garante minuto exato: atHour(6) executa dentro da janela das 06h.

 */

function criarTriggerDiarioFagundes() {

  const functionName = 'rotinaDiariaFagundes';



  // Evita duplicação: remove triggers antigos da mesma função.

  ScriptApp.getProjectTriggers().forEach(trigger => {

    if (trigger.getHandlerFunction() === functionName) {

      ScriptApp.deleteTrigger(trigger);

    }

  });



  const trigger = ScriptApp.newTrigger(functionName)

    .timeBased()

    .atHour(6)

    .everyDays(1)

    .inTimezone('America/Sao_Paulo')

    .create();



  const ss = SpreadsheetApp.getActiveSpreadsheet();

  logExecucao_(

    ss,

    'criarTriggerDiarioFagundes',

    'OK',

    0,

    1,

    'Trigger diário criado para rotinaDiariaFagundes(), janela das 06h.'

  );



  Logger.log(JSON.stringify({

    criado: true,

    handler: functionName,

    timezone: 'America/Sao_Paulo',

    janela_hora: 6,

    trigger_id: trigger.getUniqueId()

  }, null, 2));



  return {

    criado: true,

    handler: functionName,

    timezone: 'America/Sao_Paulo',

    janela_hora: 6,

    trigger_id: trigger.getUniqueId()

  };

}



/**

 * Mostra os triggers do projeto sem alterar nada.

 */

function verificarTriggersFagundes() {

  const triggers = ScriptApp.getProjectTriggers().map(trigger => ({

    handler: trigger.getHandlerFunction(),

    tipo_evento: String(trigger.getEventType()),

    origem: String(trigger.getTriggerSource()),

    id: trigger.getUniqueId()

  }));



  Logger.log(JSON.stringify(triggers, null, 2));

  return triggers;

}



/**

 * Remove somente triggers da rotina da Fagundes.

 * Útil para manutenção ou reinstalação.

 */

function removerTriggerDiarioFagundes() {

  let removidos = 0;



  ScriptApp.getProjectTriggers().forEach(trigger => {

    if (trigger.getHandlerFunction() === 'rotinaDiariaFagundes') {

      ScriptApp.deleteTrigger(trigger);

      removidos++;

    }

  });



  const ss = SpreadsheetApp.getActiveSpreadsheet();

  logExecucao_(

    ss,

    'removerTriggerDiarioFagundes',

    'OK',

    0,

    removidos,

    removidos + ' trigger(s) removido(s).'

  );



  Logger.log('Triggers removidos: ' + removidos);

  return removidos;

}



/**

 * Teste manual da rotina completa.

 * Faz exatamente o mesmo fluxo do trigger:

 * 1) atualiza Instagram RAW;

 * 2) captura snapshots maduros.

 */

function testarRotinaDiariaFagundes() {

  const inicio = new Date();

  const ss = SpreadsheetApp.getActiveSpreadsheet();



  try {

    rotinaDiariaFagundes();



    const segundos = Math.round((new Date() - inicio) / 1000);



    logExecucao_(

      ss,

      'testarRotinaDiariaFagundes',

      'OK',

      0,

      0,

      'Rotina completa testada em ' + segundos + 's.'

    );



    Logger.log(JSON.stringify({

      status: 'OK',

      duracao_segundos: segundos

    }, null, 2));



    return {

      status: 'OK',

      duracao_segundos: segundos

    };

  } catch (err) {

    logExecucao_(

      ss,

      'testarRotinaDiariaFagundes',

      'ERRO',

      0,

      0,

      err && err.message ? err.message : String(err)

    );

    throw err;

  }

}









/**

 * Etapa 8 — referências canônicas auditadas.

 *

 * ESTRATEGIA_CANONICA_ETAPA3 contém os 86 conteúdos de produção

 * calibrados na Etapa 3. O score estratégico é SEMPRE reconstruído

 * a partir dos cinco componentes aprovados:

 *   40% comercial + 25% aderência + 15% busca + 15% segurança + 5% saturação.

 *

 * TRELLO_AUDITADOS_SEM_CARD_ETAPA8 contém os 31 conteúdos de produção

 * históricos para os quais não foi encontrado vínculo Trello seguro.

 * O status significa "sem card histórico CONFIRMADO", não afirma que um

 * card nunca existiu. Isso encerra a pendência sem forçar associação.

 */

const ESTRATEGIA_CANONICA_ETAPA3 = {

  '18105686108156799': {c:100, a:95, b:80, s:95, st:85},

  '18096878804178303': {c:100, a:90, b:80, s:85, st:70},

  '17980847208061489': {c:100, a:75, b:80, s:95, st:85},

  '18537688438077056': {c:100, a:75, b:80, s:80, st:70},

  '17912786943369852': {c:100, a:75, b:80, s:95, st:85},

  '18309151246260358': {c:100, a:70, b:80, s:95, st:70},

  '18118278046638297': {c:100, a:75, b:40, s:95, st:85},

  '18597069397009476': {c:85, a:90, b:80, s:95, st:80},

  '17954615946078800': {c:100, a:75, b:80, s:95, st:85},

  '18066498437472467': {c:100, a:70, b:80, s:95, st:70},

  '18067376564537172': {c:100, a:95, b:80, s:95, st:90},

  '18080689205300919': {c:100, a:75, b:80, s:95, st:85},

  '17943776034211883': {c:100, a:55, b:40, s:95, st:70},

  '17867508429584811': {c:85, a:90, b:80, s:95, st:80},

  '18133177879539210': {c:85, a:70, b:40, s:95, st:80},

  '17893303980377669': {c:85, a:95, b:80, s:95, st:90},

  '18149315104440754': {c:90, a:75, b:80, s:95, st:85},

  '17930197638387943': {c:100, a:95, b:40, s:95, st:85},

  '17884885260329599': {c:100, a:75, b:80, s:85, st:85},

  '18053775932570564': {c:100, a:95, b:80, s:95, st:85},

  '18082428221172672': {c:100, a:90, b:40, s:95, st:70},

  '18070399598356742': {c:65, a:95, b:80, s:95, st:90},

  '18134666764553489': {c:100, a:75, b:40, s:95, st:85},

  '17849534652661199': {c:100, a:70, b:40, s:95, st:70},

  '18110722997087134': {c:85, a:90, b:90, s:95, st:80},

  '17891039985517326': {c:90, a:75, b:80, s:95, st:85},

  '17930311683292355': {c:100, a:90, b:80, s:95, st:70},

  '17896319985332384': {c:100, a:90, b:80, s:95, st:70},

  '18160746850437345': {c:100, a:55, b:80, s:95, st:70},

  '18120806119755094': {c:100, a:55, b:80, s:95, st:70},

  '18118370269917315': {c:100, a:95, b:90, s:95, st:85},

  '18112680770304048': {c:85, a:70, b:80, s:95, st:80},

  '18166069156423923': {c:100, a:55, b:80, s:80, st:70},

  '18049914668595338': {c:100, a:55, b:40, s:95, st:70},

  '18163962343422392': {c:100, a:70, b:80, s:95, st:70},

  '18083008400230724': {c:100, a:55, b:80, s:95, st:70},

  '17865286023656510': {c:100, a:75, b:80, s:85, st:85},

  '18400369222089855': {c:85, a:75, b:80, s:95, st:80},

  '18109488166713528': {c:85, a:70, b:40, s:95, st:80},

  '17932898670034360': {c:100, a:70, b:40, s:95, st:70},

  '17901336927531049': {c:85, a:95, b:80, s:95, st:90},

  '18158872147468000': {c:85, a:95, b:80, s:95, st:90},

  '18092635724545733': {c:70, a:75, b:40, s:95, st:80},

  '18072211496422741': {c:90, a:95, b:50, s:80, st:85},

  '17910980688179815': {c:100, a:75, b:80, s:95, st:85},

  '17986046285867113': {c:85, a:75, b:50, s:95, st:80},

  '17964517286918706': {c:85, a:70, b:80, s:95, st:80},

  '18089165315044600': {c:100, a:75, b:80, s:95, st:85},

  '18368155048202171': {c:100, a:70, b:80, s:95, st:70},

  '18023588900671264': {c:85, a:90, b:80, s:95, st:80},

  '18065896247399139': {c:100, a:75, b:80, s:95, st:85},

  '18101956466003049': {c:85, a:90, b:80, s:95, st:80},

  '17910226650397258': {c:100, a:75, b:40, s:95, st:85},

  '18042247640743871': {c:90, a:75, b:80, s:95, st:85},

  '18227892175315219': {c:85, a:90, b:80, s:95, st:80},

  '18021890117812544': {c:50, a:75, b:90, s:95, st:80},

  '18330194182169993': {c:100, a:75, b:80, s:80, st:85},

  '18074862716310514': {c:70, a:55, b:80, s:95, st:80},

  '18091159868352918': {c:100, a:70, b:40, s:75, st:70},

  '18152584843503532': {c:70, a:55, b:80, s:95, st:80},

  '18183345001370812': {c:50, a:75, b:80, s:95, st:80},

  '18618958570047995': {c:35, a:75, b:80, s:95, st:60},

  '17865065118652671': {c:70, a:75, b:50, s:95, st:80},

  '18001179686955388': {c:65, a:95, b:80, s:80, st:90},

  '18053137289705932': {c:100, a:70, b:80, s:95, st:70},

  '17934591699285370': {c:70, a:55, b:80, s:95, st:80},

  '18093803576464057': {c:100, a:75, b:80, s:95, st:85},

  '17974970825963774': {c:85, a:55, b:80, s:95, st:80},

  '18102398743755123': {c:85, a:70, b:80, s:95, st:80},

  '17858478561642199': {c:45, a:65, b:90, s:95, st:55},

  '17859243042639369': {c:45, a:65, b:90, s:95, st:55},

  '17930727252277580': {c:100, a:75, b:80, s:60, st:70},

  '18041650670744731': {c:50, a:75, b:80, s:95, st:80},

  '17875152900435819': {c:50, a:55, b:80, s:95, st:80},

  '18029817569831078': {c:50, a:55, b:80, s:95, st:80},

  '17992372886974787': {c:100, a:55, b:80, s:95, st:70},

  '18163432405401992': {c:50, a:75, b:40, s:95, st:80},

  '18126585073529265': {c:70, a:75, b:90, s:95, st:80},

  '18107828785909053': {c:50, a:75, b:40, s:95, st:80},

  '18453466171104393': {c:35, a:75, b:80, s:95, st:60},

  '18080801306250043': {c:45, a:45, b:90, s:95, st:55},

  '18163217536424149': {c:85, a:70, b:40, s:95, st:80},

  '18102622520144369': {c:35, a:75, b:40, s:95, st:60},

  '18056926040498805': {c:70, a:55, b:80, s:95, st:80},

  '18030028214769481': {c:35, a:75, b:40, s:95, st:60},

  '17886752094558490': {c:35, a:75, b:80, s:95, st:60},

};



const TRELLO_AUDITADOS_SEM_CARD_ETAPA8 = {

  '18618958570047995': true,

  '17930197638387943': true,

  '18105686108156799': true,

  '18053775932570564': true,

  '18092635724545733': true,

  '18102622520144369': true,

  '18080689205300919': true,

  '17980847208061489': true,

  '18029817569831078': true,

  '18134666764553489': true,

  '17943776034211883': true,

  '17896319985332384': true,

  '17886752094558490': true,

  '17858478561642199': true,

  '18082428221172672': true,

  '17859243042639369': true,

  '18049914668595338': true,

  '18126585073529265': true,

  '17865065118652671': true,

  '18096878804178303': true,

  '18065896247399139': true,

  '17992372886974787': true,

  '18101956466003049': true,

  '18227892175315219': true,

  '18056926040498805': true,

  '18023588900671264': true,

  '18118278046638297': true,

  '18133177879539210': true,

  '18030028214769481': true,

  '18183345001370812': true,

  '18102398743755123': true,

};



/* ============================================================

 * ETAPA 8 — MOTOR EDITORIAL DINÂMICO / CANÔNICO FINAL V12

 * ============================================================ */



/**

 * Atualiza inteligência editorial e prepara a fila de sincronização com Trello.

 * IMPORTANTE: o motor editorial não altera cards do Trello diretamente.

 * Ele só marca vínculos únicos e gera o nome padrão:

 *   POST XX — IG <post_id>

 * A escrita no Trello ocorre em SyncTrello.gs somente após match exato e único.

 */

function atualizarMotorEditorial() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const raw = ss.getSheetByName('Instagram RAW');

  const snap = ss.getSheetByName('Snapshots');

  const insights = getOrCreateSheet_(ss, 'Insights');

  const editorial = getOrCreateSheet_(ss, 'Editorial');

  const vinculosTrello = getOrCreateSheet_(ss, 'Vínculos Trello');

  // Lê vínculos seguros antes de reconstruir a visão histórica.
  // Isso impede que MATCH_LEGENDA_EXATA seja apagado pelo catálogo legado.
  const vinculosPersistentes = lerVinculosPersistentesEtapa8_(vinculosTrello);



  if (!raw) throw new Error('Aba Instagram RAW não encontrada.');



  // Base canônica completa convertida para Google Sheets.

  // Contém os 162 posts históricos, classificação editorial e vínculos Trello confirmados.

  const canonicalSs = SpreadsheetApp.openById('1Iaa5odRnmAUznRdijkrvqc8yI_-yOKYeoJSpwz8Iayg');

  const catalogo = canonicalSs.getSheetByName('Catálogo Editorial');

  if (!catalogo) throw new Error('Catálogo Editorial não encontrado na base canônica.');



  const rawData = raw.getDataRange().getValues();

  const snapData = snap ? snap.getDataRange().getValues() : [];

  const contData = catalogo.getDataRange().getValues();



  const rh = indexHeaderEtapa8_(rawData[0]);

  const ch = indexHeaderEtapa8_(contData[0]);

  const sh = snapData.length ? indexHeaderEtapa8_(snapData[0]) : {};



  // Preserva vínculos manuais já existentes em Insights.

  const vinculosExistentes = {};

  if (insights.getLastRow() > 1) {

    const old = insights.getDataRange().getValues();

    const oh = indexHeaderEtapa8_(old[0]);

    old.slice(1).forEach(r => {

      const id = String(r[oh.media_id] || '');

      const card = String(r[oh.card_trello_id] || '');

      if (id && card) vinculosExistentes[id] = card;

    });

  }



  // Snapshots por post, com prioridade 30 > 14 > 7.

  const melhorSnapshot = {};

  if (snapData.length > 1) {

    snapData.slice(1).forEach(r => {

      const id = String(r[sh.post_id] || '');

      const dias = Number(r[sh.snapshot_dias] || 0);

      if (!id || ![7,14,30].includes(dias)) return;

      if (!melhorSnapshot[id] || dias > melhorSnapshot[id].dias) {

        melhorSnapshot[id] = { dias: dias, row: r };

      }

    });

  }



  // Catálogo canônico indexado diretamente pelo post_id.

  // Não depende de inferência por data, formato ou texto.

  const conteudoPorPost = {};

  contData.slice(1).forEach(r => {

    const postId = String(r[ch.post_id] || '');

    if (postId) conteudoPorPost[postId] = r;

  });



  // Componentes estratégicos CANÔNICOS da Etapa 3 calibrada.

  // Não usa a aba antiga "Força Editorial", porque ela é anterior à

  // calibração final. Os 86 conteúdos de produção ficam ancorados na

  // referência aprovada da Etapa 3.

  const estrategiaPorPost = {};

  Object.keys(ESTRATEGIA_CANONICA_ETAPA3).forEach(postId => {

    const x = ESTRATEGIA_CANONICA_ETAPA3[postId];

    estrategiaPorPost[postId] = {

      comercial: x.c,

      aderencia: x.a,

      busca: x.b,

      seguranca: x.s,

      saturacaoBase: x.st,

      score:

        x.c * 0.40 +

        x.a * 0.25 +

        x.b * 0.15 +

        x.s * 0.15 +

        x.st * 0.05

    };

  });



  // Auditoria dos vínculos Trello históricos.

  // Um mesmo card_trello_id não pode representar dois posts diferentes.

  const postsPorCardTrello = {};

  contData.slice(1).forEach(r => {

    const postId = String(r[ch.post_id] || '');

    const cardId = String(r[ch.card_trello_id] || '');

    if (!postId || !cardId) return;

    if (!postsPorCardTrello[cardId]) postsPorCardTrello[cardId] = [];

    postsPorCardTrello[cardId].push(postId);

  });



  const vinculoPorPost = {};

  const vinculoRows = [];



  contData.slice(1).forEach(r => {

    const postId = String(r[ch.post_id] || '');

    if (!postId) return;



    const cardId = String(r[ch.card_trello_id] || '');

    const cardUrl = String(r[ch.card_trello_url] || '');

    const confianca = String(r[ch.confianca_vinculo] || '');

    const formatoCatalogo = normalizarFormatoEtapa8_(r[ch.formato]);

    const duplicado = cardId && (postsPorCardTrello[cardId] || []).length > 1;



    let status = 'PENDENTE';

    let acao = 'LOCALIZAR CARD';



    // Reels são apenas inteligência contextual na estratégia Fagundes.

    // A ausência de Trello para Reel não é pendência operacional.

    if (formatoCatalogo === 'Reel' && !cardId) {

      status = 'NÃO EXIGIDO — REEL';

      acao = 'NENHUMA';

    } else if (!cardId && TRELLO_AUDITADOS_SEM_CARD_ETAPA8[postId]) {

      status = 'SEM CARD HISTÓRICO CONFIRMADO';

      acao = 'NENHUMA';

    } else if (cardId && duplicado) {

      status = 'CONFLITO HISTÓRICO';

      acao = 'REVISAR ANTES DE RENOMEAR';

    } else if (cardId && confianca.toUpperCase() === 'ALTA') {

      status = 'CONFIRMADO ÚNICO';

      // O Apps Script valida o vínculo de dados. O estado visual do nome

      // do card é responsabilidade da sincronização Trello.

      acao = 'VÍNCULO OK';

    } else if (cardId) {

      status = 'VÍNCULO NÃO VALIDADO';

      acao = 'REVISAR';

    }



    const nomeBase = inferirNomeBaseTrelloEtapa8_(cardUrl);

    const nomePadrao = cardId

      ? nomeBase + ' — IG ' + postId

      : '';



    vinculoPorPost[postId] = {

      cardId: cardId,

      cardUrl: cardUrl,

      confianca: confianca,

      status: status,

      nomePadrao: nomePadrao,

      podeUsar: status === 'CONFIRMADO ÚNICO'

    };



    vinculoRows.push([

      postId,

      cardId,

      cardUrl,

      confianca,

      status,

      nomePadrao,

      acao,

      duplicado ? (postsPorCardTrello[cardId] || []).join(', ') : ''

    ]);

  });



  // Mescla vínculos confirmados criados fora do catálogo histórico,
  // incluindo os novos vínculos automáticos por legenda.
  mesclarVinculosPersistentesEtapa8_(
    vinculoPorPost,
    vinculoRows,
    vinculosPersistentes
  );



  escreverTabelaEtapa8_(
    vinculosTrello,
    FAGUNDES_SYNC.HEADERS,
    vinculoRows
  );



  const insightRows = [];

  const now = new Date();

  const idsRetornadosApi = {};



  rawData.slice(1).forEach(r => {

    const id = String(r[rh.post_id] || '');

    if (!id) return;

    idsRetornadosApi[id] = true;



    const pub = parseDateEtapa8_(r[rh.publicado_em]);

    const fmt = normalizarFormatoEtapa8_(r[rh.formato]) || String(r[rh.formato] || '');

    const s = melhorSnapshot[id];



    let reach = Number(r[rh.alcance] || 0);

    let saved = Number(r[rh.salvamentos] || 0);

    let shares = Number(r[rh.compartilhamentos] || 0);

    let likes = Number(r[rh.curtidas] || 0);

    let comments = Number(r[rh.comentarios] || 0);

    let views = Number(r[rh.visualizacoes] || 0);

    let janela = 'ATUAL';



    if (s) {

      const sr = s.row;

      reach = Number(sr[sh.alcance] || 0);

      saved = Number(sr[sh.salvamentos] || 0);

      shares = Number(sr[sh.compartilhamentos] || 0);

      likes = Number(sr[sh.curtidas] || 0);

      comments = Number(sr[sh.comentarios] || 0);

      views = Number(sr[sh.visualizacoes] || 0);

      janela = s.dias + 'D';

    }



    const catalogRow = conteudoPorPost[id];

    const vt = vinculoPorPost[id];

    let card = (vt && vt.podeUsar) ? vt.cardId : '';

    let sync = !catalogRow
      ? (
          vt && vt.podeUsar
            ? 'TRELLO CONFIRMADO / CATÁLOGO PENDENTE'
            : 'NÃO ENCONTRADO NO CATÁLOGO CANÔNICO'
        )
      : !vt
        ? 'CATÁLOGO CANÔNICO / TRELLO PENDENTE'
        : vt.status;



    insightRows.push([

      id, pub || r[rh.publicado_em], fmt,

      r[rh.descricao] || '', r[rh.permalink] || '',

      reach, saved, shares, likes, comments,

      saved + shares + likes + comments,

      views, janela,

      pub ? Math.floor((now - pub) / 86400000) : '',

      r[rh.coletado_em] || '',

      card, sync,

      (vt && vt.nomePadrao) ? vt.nomePadrao : ''

    ]);

  });



  // Preserva os posts históricos que não são mais retornados por /media.

  // A regra canônica é: API atualiza o que enxerga; o histórico legado não é apagado.

  // Para esses registros usamos as últimas métricas históricas do Catálogo Editorial.

  contData.slice(1).forEach(c => {

    const id = String(c[ch.post_id] || '');

    if (!id || idsRetornadosApi[id]) return;



    const pub = parseDateCanonicaEtapa11_(c[ch.publicado_em]);

    const fmt = normalizarFormatoEtapa8_(c[ch.formato]) || String(c[ch.formato] || '');

    const vt = vinculoPorPost[id];

    const card = (vt && vt.podeUsar) ? vt.cardId : '';



    const reach = Number(c[ch.alcance] || 0);

    const saved = Number(c[ch.salvamentos] || 0);

    const shares = Number(c[ch.compartilhamentos] || 0);

    const likes = Number(c[ch.curtidas] || 0);

    const comments = Number(c[ch.comentarios] || 0);

    const views = Number(c[ch.visualizacoes] || 0);



    let sync = 'LEGADO CSV / NÃO RETORNADO PELA API';

    if (fmt === 'Reel') sync = 'LEGADO CSV / REEL CONTEXTUAL';

    else if (vt && vt.podeUsar) sync = 'LEGADO CSV + TRELLO CONFIRMADO';

    else if (vt && vt.status === 'SEM CARD HISTÓRICO CONFIRMADO') sync = 'LEGADO CSV / SEM CARD HISTÓRICO CONFIRMADO';

    else if (vt && vt.status === 'PENDENTE') sync = 'LEGADO CSV / TRELLO PENDENTE';



    insightRows.push([

      id,

      pub || c[ch.publicado_em],

      fmt,

      c[ch.descricao] || '',

      c[ch.permalink] || '',

      reach, saved, shares, likes, comments,

      saved + shares + likes + comments,

      views,

      'LEGADO CSV',

      pub ? Math.floor((now - pub) / 86400000) : '',

      '',

      card,

      sync,

      (vt && vt.nomePadrao) ? vt.nomePadrao : ''

    ]);

  });



  // Mantém a leitura cronológica mesmo depois de mesclar API + legado.

  insightRows.sort((a, b) => {

    const da = parseDateEtapa8_(a[1]);

    const db = parseDateEtapa8_(b[1]);

    if (!da && !db) return 0;

    if (!da) return 1;

    if (!db) return -1;

    return db.getTime() - da.getTime();

  });



  const insightHeader = [

    'media_id','data_publicacao','formato','caption','permalink',

    'reach','saved','shares','likes','comments','total_interactions',

    'views','janela_metrica','idade_dias','coletado_em',

    'card_trello_id','status_sync','nome_trello_padrao'

  ];

  escreverTabelaEtapa8_(insights, insightHeader, insightRows);



  // Baselines por formato + família apenas para produção (Imagem/Carrossel).

  const grupos = {};

  insightRows.forEach(ir => {

    const c = conteudoPorPost[String(ir[0] || '')];

    if (!c) return;

    const fmt = ir[2];

    if (fmt === 'Reel') return;

    const familia = String(c[ch.familia_editorial_validada] || 'NÃO CLASSIFICADO');

    const key = fmt + '|' + familia;

    if (!grupos[key]) grupos[key] = [];

    grupos[key].push(Number(ir[5] || 0));

  });



  const editorialRows = [];



  insightRows.forEach(ir => {

    const id = ir[0], card = ir[15], fmt = ir[2], reach = Number(ir[5] || 0);

    const c = conteudoPorPost[String(id || '')];

    const idade = Number(ir[13] || 0);

    const janela = ir[12];



    if (!c) {

      editorialRows.push([

        id,card,ir[1],fmt,
        card ? 'PENDENTE DE CATÁLOGO' : 'PENDENTE DE VÍNCULO',
        '','',janela,'',

        'SEM CLASSIFICAÇÃO','NÃO CALCULADA',
        card ? 'Classificar no catálogo' : 'Vincular ao catálogo',

        idade,'','NÃO',
        card
          ? 'Vínculo Trello confirmado; classificação editorial ainda não catalogada.'
          : 'Sem vínculo seguro com card do Trello.'

      ]);

      return;

    }



    const familia = String(c[ch.familia_editorial_validada] || '');

    const tema = String(c[ch.servico_tema] || '');

    const servico = String(c[ch.servico_tema] || '');

    const risco = String('' || '').toUpperCase();

    const key = fmt + '|' + familia;

    const base = grupos[key] || [];

    const med = medianaEtapa8_(base);

    const n = base.length;



    let perf = med > 0 ? Math.max(0, Math.min(100, 50 + ((reach - med) / med) * 35)) : 50;

    let maturidade = n >= 5 ? 'COMPARÁVEL' : (n >= 3 ? 'SINAL INICIAL' : 'BASE INSUFICIENTE');



    // Ajuste de maturidade já acordado na calibração.

    if (n >= 3 && n < 5) perf = perf * 0.6 + 50 * 0.4;

    if (n < 3) perf = 50;



    // Estratégia canônica da Etapa 3:

    // 40% relevância comercial

    // 25% aderência à nova linha

    // 15% intenção de busca

    // 15% segurança clínica

    //  5% saturação temática

    const est = estrategiaPorPost[String(id || '')];

    let estrategico = est ? est.score : 50;

    const estrategiaStatus = est ? 'CANÔNICA ETAPA 3 CALIBRADA' : 'PENDENTE DE CALIBRAÇÃO';



    let forcaNum;

    if (fmt === 'Reel') forcaNum = 0;

    else if (n >= 5) forcaNum = perf * 0.35 + estrategico * 0.65;

    else if (n >= 3) forcaNum = perf * 0.25 + estrategico * 0.75;

    else forcaNum = Math.min(79.9, perf * 0.15 + estrategico * 0.85);



    let forca = fmt === 'Reel' ? 'CONTEXTO' :

      (forcaNum >= 80 ? 'FORTE' : forcaNum >= 65 ? 'POSITIVO' : forcaNum >= 50 ? 'NEUTRO' : 'FRACO');



    const saturacao = contarSaturacaoEditorial60dEtapa9_(contData, ch, familia, tema, now);

    let acao = 'Considerar variação';

    if (fmt === 'Reel') acao = 'Usar apenas como inteligência';

    else if (saturacao >= 3) acao = 'Variar tema ou abordagem no próximo ciclo';

    else if (forca === 'FORTE') acao = 'Reaproveitar princípio, sem copiar';

    else if (forca === 'POSITIVO') acao = 'Considerar nova abordagem';

    else if (forca === 'FRACO') acao = 'Evitar tema + abordagem + formato';



    editorialRows.push([

      id,card,ir[1],fmt,familia,tema,servico,janela,

      Math.round(perf * 10) / 10,maturidade,forca,acao,

      idade,saturacao,fmt === 'Reel' ? 'NÃO' : 'SIM',

      'Força numérica: ' + (Math.round(forcaNum * 10) / 10) +

      ' | performance dinâmica: ' + (Math.round(perf * 10) / 10) +

      ' | estratégico: ' + (Math.round(estrategico * 10) / 10) +

      ' | ' + estrategiaStatus +

      ' | base n=' + n +

      (est

        ? ' | comp. C/A/B/S/ST=' +

          [est.comercial, est.aderencia, est.busca, est.seguranca, est.saturacaoBase].join('/')

        : '')

    ]);

  });



  const editorialHeader = [

    'media_id','card_trello_id','data_publicacao','formato',

    'familia_editorial','tema','servico','janela_metrica',

    'performance_score','maturidade','forca_editorial',

    'acao_recomendada','dias_desde_publicacao','saturacao_60d',

    'elegivel_producao','observacao'

  ];

  escreverTabelaEtapa8_(editorial, editorialHeader, editorialRows);



  const totalApiMotor = Object.keys(idsRetornadosApi).length;

  const totalLegadoMotor = insightRows.length - totalApiMotor;



  logExecucao_(ss, 'atualizarMotorEditorial', 'OK',

    insightRows.length, editorialRows.length,

    'Insights e Editorial recalculados: ' + totalApiMotor +

    ' via API + ' + totalLegadoMotor + ' legado(s) preservado(s).');



  return {

    insights: insightRows.length,

    editorial: editorialRows.length,

    catalogados: insightRows.filter(r => conteudoPorPost[String(r[0] || '')]).length,

    fora_catalogo: insightRows.filter(r => !conteudoPorPost[String(r[0] || '')]).length,

    trello_confirmados_unicos: vinculoRows.filter(r =>
      String(r[4] || '').toUpperCase().indexOf('CONFIRMADO') === 0
    ).length,

    pendentes_producao: vinculoRows.filter(r => r[4] === 'PENDENTE').length,

    sem_card_historico_confirmado: vinculoRows.filter(r => r[4] === 'SEM CARD HISTÓRICO CONFIRMADO').length,

    reels_contexto_sem_trello: vinculoRows.filter(r => r[4] === 'NÃO EXIGIDO — REEL').length,

    conflitos_trello: vinculoRows.filter(r => r[4] === 'CONFLITO HISTÓRICO').length,

    estrategia_canonica: editorialRows.filter(r => estrategiaPorPost[String(r[0] || '')]).length,

    estrategia_pendente: editorialRows.filter(r =>

      r[3] !== 'Reel' && !estrategiaPorPost[String(r[0] || '')]

    ).length,

    posts_api: totalApiMotor,

    posts_legado_preservados: totalLegadoMotor,

    producao_total: editorialRows.filter(r => r[3] !== 'Reel').length,

    reels_contextuais_total: editorialRows.filter(r => r[3] === 'Reel').length

  };

}



function escreverTabelaEtapa8_(sheet, header, rows) {

  sheet.clearContents();

  // IDs do Instagram excedem a precisão segura de números em planilhas.

  // A primeira coluna deve ser texto antes de qualquer escrita.

  sheet.getRange('A:A').setNumberFormat('@');

  sheet.getRange(1,1,1,header.length).setValues([header]);

  if (rows.length) {

    const safeRows = rows.map(r => {

      const copy = r.slice();

      if (copy.length) copy[0] = String(copy[0] || '');

      return copy;

    });

    sheet.getRange(2,1,safeRows.length,header.length).setValues(safeRows);

  }

  sheet.setFrozenRows(1);

}



function indexHeaderEtapa8_(header) {

  const o = {};

  header.forEach((v,i) => o[String(v).trim()] = i);

  return o;

}



function normalizarFormatoEtapa8_(v) {

  const s = String(v || '').toUpperCase();

  if (s.includes('REEL') || s === 'VIDEO') return 'Reel';

  if (s.includes('CARROSSEL')) return 'Carrossel';

  if (s.includes('CARD') || s.includes('IMAGEM') || s.includes('ÚNICO') || s.includes('UNICO')) return 'Imagem';

  return String(v || '');

}



function inferirNomeBaseTrelloEtapa8_(url) {

  const s = String(url || '');



  // Funciona com slugs antigos e novos:

  // 522-post-08

  // 522-post-08-ig-18152584843503532

  const m = s.match(/-post-(\d+)/i);

  if (m) return 'POST ' + String(m[1]).padStart(2, '0');



  return 'POST';

}



function parseDateCanonicaEtapa11_(v) {

  if (v instanceof Date && !isNaN(v)) return v;



  const s = String(v || '').trim();

  if (!s) return null;



  // A base canônica veio da importação do XLSX e os textos de data ficaram

  // em ordem americana: MM/DD/YYYY HH:MM. Esta função é usada SOMENTE

  // para campos publicados_em da base canônica.

  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);

  if (m) {

    const mes = +m[1];

    const dia = +m[2];

    const ano = +m[3];

    const hora = +(m[4] || 0);

    const minuto = +(m[5] || 0);

    const segundo = +(m[6] || 0);



    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;



    const d = new Date(ano, mes - 1, dia, hora, minuto, segundo);

    // Evita o comportamento de overflow silencioso do JavaScript.

    if (

      d.getFullYear() !== ano ||

      d.getMonth() !== mes - 1 ||

      d.getDate() !== dia

    ) return null;



    return d;

  }



  // Suporte defensivo caso a base passe a fornecer ISO em algum momento.

  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);

  if (m) {

    const ano = +m[1];

    const mes = +m[2];

    const dia = +m[3];

    const d = new Date(ano, mes - 1, dia, +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));

    if (

      d.getFullYear() !== ano ||

      d.getMonth() !== mes - 1 ||

      d.getDate() !== dia

    ) return null;

    return d;

  }



  return null;

}



function parseDateEtapa8_(v) {

  if (v instanceof Date && !isNaN(v)) return v;

  const s = String(v || '').trim();

  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);

  if (m) {

    const dia = +m[1];

    const mes = +m[2];

    const ano = +m[3];

    if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;

    const d = new Date(ano, mes - 1, dia, +(m[4]||0), +(m[5]||0), +(m[6]||0));

    if (d.getFullYear() !== ano || d.getMonth() !== mes - 1 || d.getDate() !== dia) return null;

    return d;

  }

  const d = new Date(s);

  return isNaN(d) ? null : d;

}



function chaveDataFormatoEtapa8_(dt, fmt) {

  const d = parseDateEtapa8_(dt);

  if (!d) return '';

  return Utilities.formatDate(d, 'America/Sao_Paulo', 'yyyy-MM-dd') + '|' + fmt;

}



function medianaEtapa8_(arr) {

  if (!arr.length) return 0;

  const a = arr.slice().sort((x,y) => x-y);

  const m = Math.floor(a.length/2);

  return a.length % 2 ? a[m] : (a[m-1] + a[m]) / 2;

}





function numeroEditorialEtapa9_(v) {

  if (typeof v === 'number') return isFinite(v) ? v : 0;

  const s = String(v == null ? '' : v).trim().replace('%','').replace(',','.');

  const n = Number(s);

  return isFinite(n) ? n : 0;

}



function contarSaturacaoEditorial60dEtapa9_(contData, ch, familia, servicoTema, now) {

  if (!familia || !servicoTema) return 0;

  let n = 0;

  contData.slice(1).forEach(r => {

    const d = parseDateCanonicaEtapa11_(r[ch.publicado_em]);

    if (!d) return;

    const idade = (now - d) / 86400000;

    if (idade < 0 || idade > 60) return;



    const mesmaFamilia =

      String(r[ch.familia_editorial_validada] || '') === String(familia || '');

    const mesmoServico =

      String(r[ch.servico_tema] || '') === String(servicoTema || '');



    if (mesmaFamilia && mesmoServico) n++;

  });

  return n;

}



function contarSaturacaoCanonicaEtapa8_(contData, ch, tema, now) {

  if (!tema) return 0;

  let n = 0;

  contData.slice(1).forEach(r => {

    const d = parseDateCanonicaEtapa11_(r[ch.publicado_em]);

    if (!d) return;

    const idade = (now - d) / 86400000;

    if (idade < 0 || idade > 60) return;

    if (String(r[ch.servico_tema] || '') === tema) n++;

  });

  return n;

}



function contarSaturacaoEtapa8_(contData, ch, tema, servico, now) {

  if (!tema && !servico) return 0;

  let n = 0;

  contData.slice(1).forEach(r => {

    const d = parseDateEtapa8_(r[ch.data_publicacao]);

    if (!d) return;

    const idade = (now - d) / 86400000;

    if (idade < 0 || idade > 60) return;

    const mesmoTema = tema && String(r[ch.tema] || '') === tema;

    const mesmoServico = servico && String(r[ch.servico] || '') === servico;

    if (mesmoTema || mesmoServico) n++;

  });

  return n;

}



function getOrCreateSheet_(ss, name) {

  return ss.getSheetByName(name) || ss.insertSheet(name);

}
