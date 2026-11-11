# Patch Notes — Adventure Brazilian MMORPG
Atualizações de 09/11 e 10/11/2026

## 10/11 (hoje)

### Novo
- **Canal Global:** nova aba "🌍 Global" no chat dos mapas, que fala com todos os CH/mapas do jogo. Libera no nível 50. Limite de 12 mensagens por minuto, sem links.
- **Amazonas City:** ruas com textura de pedra e meio-fio; grama nova mais clara; topos das casas com textura.
- **Contas novas** nascem em Amazonas City, perto do Gênio.

### Ajustes
- **Tecla M** abre o Mapa do Mundo em tamanho grande (M ou Esc para fechar).
- **Equipar automático** ganhou o botão "🔎 Filtro do equipar automático": escolha o atributo principal do item (STR, AGI, VIT, INT, LUK, DEX, HP) e os atributos extras (crítico, esquiva etc.), e ele equipa os itens que combinam.
- **Minimapa:** corrigido o botão de restaurar depois de minimizar (agora "▢ ABRIR").
- **Caverna Zumbi:** corrigido, monstros não passam mais do nível 50.
- **Domadora:** Tornado agora gasta 20 de mana por nível da skill e Explosão Estelar gasta 25 de mana por nível.
- **CashShop:** só existe a compra de +1000 slots por 30 💠 (a opção de +5000 slots foi removida).
- **Amazonas City:** as faixas marrons/cinzas que sobraram viraram grama.
- **Passe Supremo:** removida a informação de gold e baú na descrição (agora só mostra o ♦️ Oricalco por nível).
- **Mana:** a regeneração base de mana no MMORPG caiu para 0,5% da mana máxima por segundo (antes ~2,7%). O bônus do atributo MN continua igual.
- **XP:** matar monstros de nível abaixo do seu agora dá metade do XP.
- **Zoom inicial 1.31** para quem nunca mexeu no zoom. 1.31 também é o zoom mínimo (máximo continua 1.74).
- **Lojinhas:** a loja agora aguenta o navegador aberto e parado (tolerância de 4 min sem sinal, antes 1 min). Só fecha quando o dono realmente sai; os itens voltam para ele.
- **Login:** a tela de login agora aparece por cima da tela de servidor.
- **Deslogar** volta para a tela de login (antes caía na tela do servidor).
- **Imagens novas** nas telas de login, de servidor e de seleção de personagem.

## 09/11 (ontem)

### Novo
- **Cerco (CH 70):** mapa refeito, com 5 cristais em 5 fortalezas. O portal rosa do meio foi removido.
- **Arena PVP HARDCORE (CH 11):** tamanho dobrado (128×128) e agora com relevo. Platôs inacessíveis foram bloqueados.

### Servidor
- Cristais do Cerco: 5 (`CRY_N=5`).

## Como atualizar
- Substituir `index.html` e `server.js` no servidor e reiniciar.

> Observação: o `CERCO_TEST` ainda precisa voltar para `false` antes de ir ao ar.

## 10/11 — Unstuck e @recall
- **🆘 Unstuck** (Opções do lobby): tira o personagem de um local bugado, levando ao ponto livre mais próximo. Uso: 1 vez por minuto.
- **@recall (DEV)**: no chat, `@recall NomeDoJogador` (ou `@recall todos`) manda o jogador de volta para a cidade (Amazonas) em até ~5s. Requer atualizar o `server.js`.
- **Drops de Mítico e Divino** (equipamentos e runas) dos monstros do lobby agora só caem de mobs acima do nível 200.
- **Vilarejo Goblin:** o portal da entrada (lado oeste, ao lado do Save Cristal) levava para o CH House Blue por engano. Agora leva de volta para a Amazonas City. O portal do lado leste continua levando para a Floresta 2.
- **Caixa de Mensagens (chat privado):** agora é uma janela que dá para mover (arrastando o título) e redimensionar (canto inferior direito). A posição e o tamanho ficam salvos. Não escurece mais a tela.
- **Lobby:** removidos os avisos de drop que apareciam ao lado do chat. O histórico continua na aba "Drop" do chat.
- **Tela de login:** nova aba "⬇️ DOWNLOAD (Patcher para Windows)" na parte de baixo do quadro de login. Ela não aparece dentro do próprio patcher.
- **Carregamento:** ao atualizar a página, agora aparece uma tela "Carregando…" em vez de mostrar por 1 a 2 segundos a tela do modo IDLE antes do lobby.
- **Gênio:** a lista de teleporte agora mostra o valor de cada destino (1.000 🪙, ou "grátis" para VIP) e o seu ouro atual.
- **Bambu de Treino:** agora tem uma telinha ao lado mostrando, ao vivo, o DPS subindo a cada ataque e skill. Mostra também o total de dano, o último dano, o maior dano, o tempo e a quantidade de ataques. A telinha some depois de 3 segundos sem bater.
- **Ciclope da Floresta:** nova sprite (orc com machado) andando e atacando, em todas as variações de cor.
- **Jogadores por mapa:** o título do mapa mostra quantos jogadores estão nele (👥), e o Mapa do Mundo (M) mostra a quantidade de jogadores em cada mapa e o total online. Atualiza sozinho a cada poucos segundos.
- **PK Mode:** botão "PK OPEN" ao lado do LV (acima do círculo de nível). Libera no nível 200; ligado, você pode atacar qualquer jogador nível 200+ fora das cidades, mesmo que ele não tenha ligado o PK Mode. Jogadores abaixo do nível 200 nunca podem ser atacados. Ligar avisa todos os jogadores do mesmo mapa, só desliga depois de 1 minuto, dá +5% de XP e +0,02% de drop de equipamentos; morrer para jogador custa 7% de XP e volta para Amazonas City.
- **Mundo Chazzadorah:** o Mapa do Mundo agora mostra o nome do mundo e tem uma seta ▶ para a Região Inca (bloqueada até os mapas ficarem prontos).
