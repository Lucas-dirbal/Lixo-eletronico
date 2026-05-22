# Lixo-eletronico-

Sistema para controlar a arrecadacao de lixo eletronico da turma, com meta de 20 unidades por colega e registro de doacoes de excedente.

## Como rodar localmente

```bash
npm install
npm start
```

Depois acesse:

```text
http://localhost:3000
```

Os dados ficam salvos em SQLite no arquivo:

```text
data/lixo-eletronico.sqlite
```

## Deploy na Vercel

Na Vercel, banco SQLite em arquivo local nao e persistente. Para manter a ideia de SQLite em producao, use Turso/libSQL e configure estas variaveis de ambiente no projeto:

```text
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
```

Depois disso, cada push para a branch `main` pode gerar um novo deploy pela integracao GitHub da Vercel.
