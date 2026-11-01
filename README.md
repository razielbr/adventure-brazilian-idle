# Servidor do Adventure Brazilian IDLE

> **Online e hospedado:** login, save na nuvem **e lobby em tempo real** (jogadores reais, chat, casas) funcionam fora do Claude.
> Guia completo de hospedagem abaixo. Rodar só para testar: `ADMIN_TOKEN=uma-senha-longa node server.js` → http://localhost:3000

## Hospedar (escolha UM caminho)
**Importante:** o jogo guarda tudo em SQLite (`jogo.db`), então a hospedagem precisa de **disco persistente** (VPS, ou Render/Fly com volume). Hospedagem "grátis" sem disco apaga os dados a cada reinício.

### A) VPS (Hetzner, Contabo, DigitalOcean, Oracle Free…) com HTTPS — recomendado
1. Aponte um domínio (registro **A**) para o IP do servidor. Instale Docker (`curl -fsSL https://get.docker.com | sh`).
2. Envie esta pasta `servidor` para o servidor (scp / zip).
3. `cp .env.example .env` e edite: `ADMIN_TOKEN` (senha longa), `DOMINIO`, `DEV_USERS` (seu usuário).
4. `docker compose up -d --build` — o Caddy emite o HTTPS sozinho. Abra `https://SEU-DOMINIO`.
5. Crie sua conta no jogo (o nome em `DEV_USERS` vira dono/DEV). Painel: `/admin.html`.
6. Atualizar o jogo: troque `public/index.html` e rode `docker compose up -d --build`. Os dados ficam no volume.

### B) Render.com
Suba a pasta num repositório GitHub → New → Blueprint → aponta para `render.yaml`. Defina `ADMIN_TOKEN` e `DEV_USERS` no painel. O disco de 1 GB já vem no arquivo.

### C) Fly.io
Passos no topo do `fly.toml` (`fly launch --no-deploy --copy-config`, criar volume `dados`, `fly secrets set ADMIN_TOKEN=…`, `fly deploy`).

### D) Sem Docker (Node 22+)
`ADMIN_TOKEN=… TRUST_PROXY=1 DB=/var/lib/jogo/jogo.db node server.js` atrás de Nginx/Caddy com HTTPS. No Nginx desligue o buffer para `/api/rt`: `proxy_buffering off; proxy_read_timeout 1h;`.

## Variáveis de ambiente
| Variável | Para quê |
|---|---|
| `ADMIN_TOKEN` | **obrigatória**, 12+ caracteres (painel admin) |
| `PORT` (3000), `HOST` (0.0.0.0) | onde escuta |
| `DB` | caminho do SQLite (no Docker: `/data/jogo.db`) |
| `TRUST_PROXY=1` | use atrás de proxy/HTTPS (pega o IP real nos limites de login) |
| `DEV_USERS` | usuários DEV/donos, separados por vírgula |
| `ROOM_MAX` (120) | máx. de jogadores por canal do lobby |
| `BACKUP=0` / `BACKUP_DIR` | desliga / muda a pasta do backup diário |
| `DIA_*`, `ORC_*` | limites anti-trapaça de diamantes/oricalco |

## Online em tempo real
- Lobby, chat, visitas e compra/aluguel de casas entre jogadores usam `/api/rt` (SSE) — sem dependências, funciona atrás de Caddy/Render/Fly.
- Limites: 120 jogadores por canal, 3 conexões por conta, chat 2 msg/s. `GET /healthz` mostra salas/jogadores (monitoramento).
- Cabe bem em centenas de jogadores simultâneos num VPS pequeno (1 vCPU / 1 GB).

## Backup
O servidor faz sozinho um backup por dia (`backups/jogo-AAAAMMDD-HHMM.db`, guarda os 7 últimos). **Copie essa pasta para fora do servidor** de vez em quando (rclone, scp). No Docker: `docker compose cp jogo:/data/backups ./backups`.

## Segurança antes de abrir ao público
- `ADMIN_TOKEN` forte e só seu; HTTPS obrigatório (senhas trafegam no login).
- Termos de uso/privacidade (LGPD) se for público; pagamentos reais (Pix) ainda **não** estão ligados.
- O navegador ainda calcula batalhas; o servidor limita carteira e detecta saltos (veja abaixo).

---
(Documentação original)

## Rodar
    cd servidor
    ADMIN_TOKEN=uma-senha-longa-sua node server.js
Jogo: http://localhost:3000 · Painel: http://localhost:3000/admin.html (pede o ADMIN_TOKEN).
Precisa de Node 22+, sem dependências. Dados em `jogo.db` (SQLite) — faça backup.
Depois de mudar o jogo, copie o novo HTML para `public/index.html` (com o bloco de login no início do <script>).

## O que já faz
- Cadastro/login; senha guardada só como hash (scrypt+salt). Nem o admin vê a senha; pode **redefinir**.
- Progresso por conta no servidor (sincroniza a cada 15 s): entra de qualquer aparelho.
- Painel admin: usuários, inventário (JSON), alertas, banir, redefinir senha.
- Alertas no servidor: nível > 300, salto de nível ≥ 40, +5000 oricalco, +100 personagens (ajuste `LIM`).
- Ranking global por nível (`/api/ranking`), limite de tentativas de login/cadastro.

- **ID anti-clonagem:** todo item/runa/poção/personagem tem um ID único (🆔 aparece no inventário). O jogo remove duplicatas do mesmo ID; o servidor guarda o dono de cada ID, remove do save qualquer item copiado de outra conta ou que volte depois de gasto/vendido (save antigo restaurado) e avisa no painel admin (que também busca um ID).

## Ainda NÃO faz
1. Anti-trapaça real: o navegador ainda calcula batalha e drops; o servidor só detecta saltos. Mover drops/baús/recompensas para o servidor.
2. PVP, torneio, guilda e GVG entre jogadores reais (hoje simulados): endpoints + WebSocket.
3. Pix real: provedor (Mercado Pago, Asaas, Efí) com webhook confirmado no servidor.
4. Publicar: HTTPS (Caddy/Nginx + domínio) em VPS/Railway/Fly.io, ADMIN_TOKEN em variável de ambiente, backup diário.
5. Termos de uso e privacidade (LGPD).

## Carteira protegida (diamantes/oricalco)
- Diamantes e oricalco só podem **subir** até um teto por envio + por tempo + por dia (env: `DIA_PUSH`, `DIA_RATE`, `DIA_DAY`, `ORC_PUSH`, `ORC_RATE`, `ORC_DAY`; padrão 5000 + 20/s, 60000/dia; oricalco 300 + 2/s, 3000/dia). O excedente é cortado, gera alerta e o jogo recebe o valor corrigido. Contas DEV são isentas.
- **Compras Pix:** no admin, "Creditar" grava um crédito pendente; ele entra no próximo envio/carregamento do jogador (nunca é cortado).
- **Histórico:** o servidor guarda até 30 snapshots (1 a cada 10 min). No admin, "Histórico de saves → Restaurar" volta o save; a conta fica travada e deslogada até você clicar em Liberar.

## Painel Admin dentro do jogo
Abra o jogo com `?admin=1` no endereço (uma vez) para aparecer o botão 🛠️ no canto inferior esquerdo. Digite o ADMIN_TOKEN, escolha o alvo (todos ou um jogador) e marque o que apagar: Equipamentos, Runas, Personagens (volta aos 4 iniciais) e Fases. Há também o RESET COMPLETO. Os jogadores afetados recarregam sozinhos em até 15 s.

## Quem é DEV/Admin
- Jogador comum **não** vê DEV Area, painel 🛠️ nem as abas Vilões/Itens, e não troca de profissão (o servidor também força isso).
- Para marcar donos/editores como DEV: inicie com `$env:DEV_USERS="seunome,outro"` (nomes de usuário separados por vírgula) ou clique em "Marcar DEV" no /admin.html. Contas DEV veem a DEV Area e o botão 🛠️ (que ainda pede o ADMIN_TOKEN).
