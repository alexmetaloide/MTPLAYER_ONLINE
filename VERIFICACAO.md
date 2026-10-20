# Verificação — MTPLAYER Web

## Execução local realizada

- `npm test`: **18 testes aprovados**, sem dependências externas ou contas reais, incluindo feedback do login, envio duplicado, leitura dos campos e timeout.
- `node --check`: scripts JavaScript/MJS sem erros de sintaxe.
- `npm run build`: arquivos estáticos gerados em `dist/`.
- Navegador real em `http://127.0.0.1:4173`: inicialização, formulário M3U, importação de arquivo local por `File`, seleção de perfil, tela inicial e catálogo com dados sintéticos.
- Abertura de canal na interface original: vídeo MP4 sintético em reprodução, `readyState = 4`, duração 120 segundos.
- Abertura de detalhes de filme e reprodução pela interface: vídeo carregado; menu de velocidade aplicado a **1,25×** no `HTMLVideoElement` real.
- `WebPlayer` da própria aplicação: reprodução HLS e MPEG-TS com os motores distribuídos, `readyState = 4` e largura de vídeo 640 pixels.
- Service worker registrado e controlando a página local. A estratégia guarda apenas os caminhos estáticos enumerados no build, não URLs de provedor.

Os vídeos e playlists sintéticos usados na verificação foram colocados temporariamente apenas na saída local de build. **Não integram o projeto publicado.**

## Limites

Não foram usados provedores/contas IPTV reais. Não se verificaram Smart TVs, todos os codecs, comportamento em todos os navegadores, reprodução prolongada ou layout em dispositivo móvel físico. O teste local não demonstra que um provedor aceita CORS/HTTPS no endereço GitHub Pages. A publicação online precisa de acesso de escrita ao repositório e Pages ativado.

## Correção web.2 — botão de conexão

O erro foi reproduzido no site publicado usando `http://example.com` e credenciais fictícias, sem requisição ao provedor: a validação recusava HTTP, mas o toast estava dentro de `#app` (contexto de empilhamento `z-index: 1`), atrás do backdrop do login (`z-index: 20`). O teste de hit-testing identificou o backdrop na frente da mensagem.

A correção move o toast para fora desse contexto e mostra progresso/erro persistente no próprio formulário. A montagem de FormData agora está dentro do tratamento de erros; o botão é liberado em `finally`, tentativas duplicadas são ignoradas e respostas Xtream têm limite de 15 segundos por endpoint (dois endpoints possíveis). Isso não altera as exigências de HTTPS/CORS do navegador.

Após a alteração, o navegador local confirmou erro de campos vazios visível no formulário (hit-testing na própria mensagem), botão novamente habilitado e toast como filho de `body`. Uma nova conexão M3U por arquivo sintético fechou o login e abriu a seleção de perfil.
