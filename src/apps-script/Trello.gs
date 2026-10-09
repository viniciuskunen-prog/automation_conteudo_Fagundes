/**
 * Fagundes Odontologia — integração Trello
 *
 * Credenciais obrigatórias em Script Properties:
 * - TRELLO_API_KEY
 * - TRELLO_TOKEN
 *
 * IDs de board/listas podem ser sobrescritos por Script Properties, mas os
 * defaults abaixo correspondem ao board operacional atual da Fagundes.
 */

const FAGUNDES_TRELLO = {
  API_BASE: 'https://api.trello.com/1',
  BOARD_ID: '62fe5d33fdb6558abf2eacc9',
  LIST_PLANEJAMENTO_ID: '6a9b5255fb8fc545bd7bb3d2',
  LIST_POSTAR_ID: '62fe5da096fb25342f1d1bcc',
  LIST_POSTADOS_ID: '6327aca67caad80526a8a2fe',
  CARD_FIELDS: [
    'id',
    'name',
    'desc',
    'url',
    'shortUrl',
    'due',
    'dueComplete',
    'idList',
    'closed',
    'dateLastActivity'
  ].join(',')
};

function trelloEstaConfigurado_() {
  const props = PropertiesService.getScriptProperties();
  return Boolean(
    props.getProperty('TRELLO_API_KEY') &&
    props.getProperty('TRELLO_TOKEN')
  );
}

function getTrelloConfig_() {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('TRELLO_API_KEY');
  const token = props.getProperty('TRELLO_TOKEN');

  if (!apiKey) {
    throw new Error('TRELLO_API_KEY não configurado em Script Properties.');
  }
  if (!token) {
    throw new Error('TRELLO_TOKEN não configurado em Script Properties.');
  }

  return {
    apiKey: apiKey,
    token: token,
    boardId: props.getProperty('TRELLO_BOARD_ID') || FAGUNDES_TRELLO.BOARD_ID,
    listPlanejamentoId:
      props.getProperty('TRELLO_LIST_PLANEJAMENTO_ID') ||
      FAGUNDES_TRELLO.LIST_PLANEJAMENTO_ID,
    listPostarId:
      props.getProperty('TRELLO_LIST_POSTAR_ID') ||
      FAGUNDES_TRELLO.LIST_POSTAR_ID,
    listPostadosId:
      props.getProperty('TRELLO_LIST_POSTADOS_ID') ||
      FAGUNDES_TRELLO.LIST_POSTADOS_ID
  };
}

function trelloRequest_(method, path, query, payload) {
  const cfg = getTrelloConfig_();
  const params = Object.assign({}, query || {}, {
    key: cfg.apiKey,
    token: cfg.token
  });

  const queryString = Object.keys(params)
    .filter(key => params[key] !== null && params[key] !== undefined)
    .map(key =>
      encodeURIComponent(key) + '=' + encodeURIComponent(params[key])
    )
    .join('&');

  const url =
    FAGUNDES_TRELLO.API_BASE +
    path +
    (queryString ? '?' + queryString : '');

  const options = {
    method: String(method || 'get').toLowerCase(),
    muteHttpExceptions: true,
    followRedirects: true,
    headers: {
      Accept: 'application/json'
    }
  };

  if (payload && Object.keys(payload).length) {
    options.payload = payload;
  }

  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  const text = response.getContentText();

  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = text;
    }
  }

  if (code < 200 || code >= 300) {
    const detail =
      data && data.message
        ? data.message
        : typeof data === 'string'
          ? data
          : JSON.stringify(data || {});

    throw new Error(
      'Trello API HTTP ' + code + ': ' + String(detail).slice(0, 500)
    );
  }

  return data;
}

function trelloListarCardsDaLista_(listId) {
  const data = trelloRequest_(
    'get',
    '/lists/' + encodeURIComponent(listId) + '/cards',
    {
      fields: FAGUNDES_TRELLO.CARD_FIELDS,
      filter: 'open'
    }
  );

  return Array.isArray(data) ? data : [];
}

function trelloListarCardsPostar_() {
  const cfg = getTrelloConfig_();
  return trelloListarCardsDaLista_(cfg.listPostarId);
}

function trelloListarCardsPlanejamento_() {
  const cfg = getTrelloConfig_();
  return trelloListarCardsDaLista_(cfg.listPlanejamentoId);
}

function trelloBuscarCard_(cardId) {
  if (!cardId) return null;

  return trelloRequest_(
    'get',
    '/cards/' + encodeURIComponent(cardId),
    {
      fields: FAGUNDES_TRELLO.CARD_FIELDS
    }
  );
}

/**
 * Fecha o fluxo operacional após a publicação real:
 * - move para POSTADOS;
 * - marca o vencimento como concluído.
 *
 * A chamada é idempotente: repetir os mesmos valores não cria outro card.
 */
function trelloMoverParaPostados_(cardId) {
  const cfg = getTrelloConfig_();

  return trelloRequest_(
    'put',
    '/cards/' + encodeURIComponent(cardId),
    null,
    {
      idList: cfg.listPostadosId,
      dueComplete: 'true'
    }
  );
}

function testarConexaoTrello() {
  const cfg = getTrelloConfig_();

  const board = trelloRequest_(
    'get',
    '/boards/' + encodeURIComponent(cfg.boardId),
    {
      fields: 'id,name,url'
    }
  );

  Logger.log(JSON.stringify(board, null, 2));
  return board;
}

function diagnosticarCardsPostar() {
  if (!trelloEstaConfigurado_()) {
    return {
      configurado: false,
      mensagem: 'Trello ainda não configurado em Script Properties.'
    };
  }

  const cards = trelloListarCardsPostar_().map(card => ({
    card_id: String(card.id || ''),
    nome: card.name || '',
    due: card.due || '',
    legenda_encontrada: Boolean(extrairLegendaCardTrello_(card.desc || '')),
    legenda: extrairLegendaCardTrello_(card.desc || '')
  }));

  Logger.log(JSON.stringify(cards, null, 2));
  return cards;
}
