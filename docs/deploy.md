# Deploy automático — GitHub → Google Apps Script

## Objetivo

Todo push na branch `main` que alterar código Apps Script dispara automaticamente:

```text
GitHub
  ↓
GitHub Actions
  ↓
@google/clasp 3.4.1
  ↓
clasp push --force
  ↓
projeto Apps Script da Fagundes
```

O workflow também pode ser executado manualmente pela aba **Actions** usando `workflow_dispatch`.

## Arquivos que disparam deploy

Somente alterações em:

- `src/apps-script/**/*.gs`
- `src/apps-script/**/*.html`
- `src/apps-script/appsscript.json`

Documentação, regras e prompts não fazem deploy.

## Secrets obrigatórios

No GitHub:

`Settings → Secrets and variables → Actions → New repository secret`

Criar exatamente:

### `APPS_SCRIPT_ID`

Valor: Script ID do projeto Apps Script vinculado à planilha Fagundes.

No editor Apps Script:

`Project Settings → IDs → Script ID`

### `CLASPRC_JSON`

Valor: conteúdo integral do arquivo de autenticação do clasp.

Esse conteúdo é credencial OAuth. Nunca commitá-lo no repositório.

## Como gerar CLASPRC_JSON

Em uma máquina confiável com Node.js:

```bash
npx @google/clasp@3.4.1 login
```

Autorize com a mesma conta Google que possui acesso de edição ao projeto Apps Script da Fagundes.

Depois copie o conteúdo de:

```text
~/.clasprc.json
```

e salve-o como o secret `CLASPRC_JSON` no GitHub.

Depois de criar o secret, o arquivo local pode permanecer apenas na máquina confiável e nunca deve entrar no Git.

## Segurança

O repositório pode ser público porque:

- Script ID é armazenado como secret por conveniência;
- OAuth do clasp fica em `CLASPRC_JSON`;
- tokens Meta e Trello continuam em Script Properties;
- nenhuma credencial é escrita no repositório.

GitHub mascara secrets nos logs, mas código e scripts nunca devem imprimir o conteúdo das credenciais.

## Serialização

O workflow usa um grupo de `concurrency` exclusivo da produção. Se dois commits forem enviados em sequência, um deploy aguarda o outro em vez de cancelar o primeiro no meio.

## O que o deploy faz

O pipeline executa `clasp push --force`.

Isto sincroniza os arquivos-fonte do Git com o projeto Apps Script. Para um script container-bound usado por triggers, isso é suficiente para atualizar o código executado pelo projeto.

Não cria um novo Web App/API deployment automaticamente. Se o projeto futuramente ganhar um deployment versionado desse tipo, ele deve ter um workflow separado.

## Primeiro deploy

Antes do primeiro push de código:

1. configurar `APPS_SCRIPT_ID`;
2. configurar `CLASPRC_JSON`;
3. garantir que a API do Google Apps Script esteja habilitada para a conta quando exigido pelo clasp;
4. versionar o `appsscript.json` real;
5. versionar os arquivos `.gs` reais;
6. conferir a execução em **Actions → Deploy Apps Script**.

## Rollback

Como o Git é a fonte canônica:

1. reverta o commit problemático;
2. envie o revert para `main`;
3. o workflow fará novo `clasp push` com a versão anterior.

Antes de habilitar mudanças funcionais relevantes, manter uma baseline do código atualmente em produção.
