# Especificação — sincronização caption Meta × legenda Trello

## Objetivo

Detectar automaticamente quando um card em `POSTAR` foi efetivamente publicado no Instagram e fechar seu fluxo sem depender de movimentação manual.

## Pré-condição operacional

Se a legenda for alterada antes de publicar, a mesma versão final deve ser atualizada no Trello.

## Extração

### Meta

Usar a `caption` retornada pela Graph API.

### Trello

Extrair apenas o bloco de legenda final do card.

O parser deve aceitar o formato atual dos cards da Fagundes, que utiliza separadores como:

```text
---
LEGENDA
...
```

ou equivalente previamente documentado.

Se o bloco não puder ser identificado com segurança, o card não é elegível para match automático.

## Normalização permitida

A função de normalização pode alterar somente:

- Unicode para uma forma canônica;
- `\r\n` e `\r` para `\n`;
- espaços/tabs repetidos para um espaço;
- múltiplas linhas vazias equivalentes;
- espaços nas bordas de linhas e do texto.

Não remover:

- palavras;
- pontuação;
- acentos;
- emojis;
- hashtags;
- CTA;
- localização;
- URLs.

## Regra de match

```text
normalize(meta.caption) === normalize(trello.caption)
```

### 1 resultado

`CONFIRMADO_AUTO`

### 0 resultados

`SEM_MATCH`

Não mover nenhum card.

### >1 resultado

`AMBIGUO`

Não mover nenhum card.

Registrar IDs candidatos no log.

## Ações após match único

1. validar que `media_id` ainda não está vinculado a outro card;
2. validar que o card ainda não está vinculado a outro `media_id`;
3. gravar vínculo;
4. gravar permalink;
5. gravar data de publicação;
6. atualizar status do vínculo;
7. mover card de `POSTAR` para `POSTADOS`;
8. marcar due como concluído quando aplicável;
9. atualizar contagem do ciclo;
10. registrar log transacional.

## Falha parcial

Operações devem ser retomáveis.

Se o vínculo já estiver salvo e o card ainda estiver em `POSTAR`, uma nova execução deve reparar a movimentação sem criar outro vínculo.

Se o card já estiver em `POSTADOS` e o vínculo existir, a execução deve ser idempotente.

## Conteúdo orgânico

Uma publicação sem card correspondente não deve ser forçada a nenhum card.

Após janela definida de reconciliação, poderá ser classificada como `ORGANICO_SEM_CARD`.
