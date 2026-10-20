# MTPLAYER Web

Versão web do MTPLAYER 0.2.13, em português, preparada para **GitHub Pages**. A versão Windows original não é alterada. Esta pasta é um projeto independente: publique **somente seu conteúdo**, nunca a pasta completa do aplicativo Windows.

**Repositório:** https://github.com/alexmetaloide/MTPLAYER_ONLINE  
**Endereço previsto após ativar/publicar o Pages:** https://alexmetaloide.github.io/MTPLAYER_ONLINE/

## Rodar no computador

Instale Node.js 22 ou superior. Dentro desta pasta:

```powershell
npm test
npm run build
npm start
```

Abra **http://127.0.0.1:4173**. Não abra `index.html` por duplo clique. Não é necessário `npm install`: não há dependências de build. Os motores HLS e MPEG-TS já estão incluídos.

## Colocar online no GitHub

1. O repositório escolhido é `alexmetaloide/MTPLAYER_ONLINE`. Verifique seus direitos de publicar o código e a marca. A distribuição original não declara licença aberta.
2. Para um primeiro envio manual, abra um terminal **dentro de `webapp`**:

```powershell
git init -b main
git add .
git commit -m "Adicionar MTPLAYER Web"
git remote add origin https://github.com/alexmetaloide/MTPLAYER_ONLINE.git
git push -u origin main
```

3. No GitHub, vá em **Settings → Pages → Build and deployment → Source → GitHub Actions**.
4. Em **Actions → Publicar MTPLAYER Web → Run workflow**, execute o fluxo se a primeira publicação ainda não tiver ocorrido. Aguarde os testes e a publicação terminarem.
5. Seu endereço será **https://alexmetaloide.github.io/MTPLAYER_ONLINE/**. O fluxo mostra o endereço exato. Atualizações na branch `main` publicam automaticamente.

O fluxo deve ficar em `.github/workflows/pages.yml` na **raiz do repositório**. Por isso, envie o conteúdo de `webapp`, não a pasta externa com o executável. GitHub Pages em repositório privado depende do seu plano GitHub.

## Recursos adaptados

- Interface original: TV ao vivo, filmes, séries, rádio, busca, Descubra, recentes e recomendações.
- Contas Xtream Codes e M3U por URL; abertura de M3U local sem upload.
- Perfis, favoritos, histórico, continuidade, bloqueios por título, avaliações e velocidade de reprodução, utilizando a interface e os módulos existentes.
- Reprodução HTML5, HLS e MPEG-TS quando o navegador suporta os codecs.
- EPG Xtream/XMLTV, gzip e TV atrasada quando fornecidos pelo provedor.
- Download/importação de backup JSON sanitizado. Capas não são exportadas porque seus links podem conter tokens.
- Layout móvel, manifesto e service worker para armazenar apenas os arquivos estáticos da interface. A instalação como aplicativo depende do navegador; streams **não** ficam disponíveis offline.

## Limitações importantes

**GitHub Pages hospeda arquivos estáticos; não fornece backend/proxy.**

- O servidor IPTV precisa oferecer **HTTPS válido e CORS** para o domínio do site. Em HLS isso também se aplica aos segmentos, variantes e chaves; em MPEG-TS à transmissão. O site não remove essas proteções.
- Abrir M3U local evita baixar a playlist por CORS, mas não resolve restrições dos streams. Os links devem ser HTTP/HTTPS absolutos. `file:`, `rtsp:`, caminhos locais e links relativos não são aceitos na reprodução.
- Não há instalação de codecs ou player nativo: HEVC, MKV, AC3, DRM e outros formatos podem não funcionar. Use formatos web fornecidos pelo provedor (idealmente HLS/H.264/AAC ou MP4 compatível).
- Streams que exigem `User-Agent` ou `Referer` personalizado são recusados: o navegador controla esses cabeçalhos.
- Sem Chromecast, gravação, sincronização entre aparelhos ou garantia de funcionamento em Smart TVs.
- Séries Xtream usam temporadas/episódios da API. Em M3U cada entrada classificada como série aparece como um episódio; não há agrupamento automático de temporadas.
- Reprodução automática e tela cheia dependem das permissões e gestos exigidos pelo navegador.

## Dados e privacidade

- O app não fornece canais/conteúdo; use apenas listas que você está autorizado a acessar.
- Credenciais, URLs de playlist e conteúdo M3U ficam em **sessionStorage desta aba**, sem criptografia em repouso. Não são incluídos no código publicado ou enviados ao GitHub pelo app. O navegador pode restaurar a sessão após fechar: remova as contas nas configurações e limpe os dados do site ao usar equipamento compartilhado.
- O provedor recebe as requisições necessárias à autenticação/reprodução, e servidores de imagens recebem requisições de capas. GitHub hospeda apenas os arquivos da interface. Não existe proxy público nem analytics acrescentado por esta adaptação.
- Favoritos, histórico e perfis ficam no `localStorage` deste site. Não há sincronização, criptografia ou isolamento de usuários do mesmo navegador. PIN é uma barreira de interface, não um controle de segurança do servidor.
- Catálogo, fontes e programação ficam em memória e são recarregados ao reabrir. Playlists locais grandes podem exceder a quota de sessão: nesse caso a conta não é salva e um erro é exibido.
- Ao reconectar a mesma conta, o identificador determinístico preserva o vínculo com os perfis web. Backups Windows podem ser lidos, mas os IDs de conta/M3U são diferentes: a associação automática de dados desktop não é suportada.
- Faça backup antes de limpar os dados do navegador. Não envie arquivos pessoais, backups, listas ou credenciais ao repositório.

## Estrutura

- `app/`: interface copiada da distribuição e adaptada para web.
- `app/web/`: API de navegador, provedores, rede, arquivos e inicialização.
- `scripts/`: build estático e servidor local, sem pacotes adicionais.
- `tests/`: testes automatizados com dados fictícios, sem contas reais.
- `.github/workflows/pages.yml`: testes, build e deploy no Pages.
- `dist/`: saída gerada, ignorada pelo Git.

## Verificação e origem

Os testes de `tests/web.test.mjs` cobrem parsing M3U, identidade/isolamento de contas, cache, erros de rede/quota, URL segura, resposta limitada, Xtream simulado, backup e XMLTV. Não representam validação de provedores reais, todos os codecs ou televisores.

A adaptação usa os arquivos legíveis de `resources/app/renderer` e dos serviços da distribuição local. Inspeção estática REA do preload/package: `ev_05165005b23758862b3748b918b744fcf21bd6ffc9ca28718cf714025db52ccf` (escopo parcial, sem execução). As mudanças para navegador são escolhas desta adaptação; não equivalem a comportamento desktop observado em runtime.
