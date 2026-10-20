# Verificação — MTPLAYER Web

## Execução local realizada

- `npm test`: **11 testes aprovados**, sem dependências externas ou contas reais.
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
