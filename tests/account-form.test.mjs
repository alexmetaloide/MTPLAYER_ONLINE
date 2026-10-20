import test from 'node:test';
import assert from 'node:assert/strict';
import { bindAccountForm } from '../app/ui/account-form.mjs';

function fixture(t, { type = 'xtream', values = {}, onSave = async () => {}, onSuccess } = {}) {
  t.mock.method(globalThis, 'FormData', function (form) {
    this.get = key => form.values[key];
  });
  const element = () => ({
    attributes: {}, dataset: {}, hidden: true, textContent: '', disabled: false,
    setAttribute(name, value) { this.attributes[name] = value; },
    focus() { this.focused = true; },
    scrollIntoView() { this.scrolled = true; }
  });
  const submit = element();
  const status = element();
  const buttons = [element(), element()];
  const form = {
    ...element(), values: { name: 'Minha lista', server: 'https://example.com', username: 'teste', password: 'teste', ...values },
    querySelector: selector => selector === '[type="submit"]' ? submit : status
  };
  bindAccountForm(form, { getType: () => type, onSave, onSuccess, typeButtons: buttons });
  const send = () => form.onsubmit({ preventDefault() {} });
  return { form, submit, status, buttons, send };
}

test('conexão: erro fica persistente dentro do formulário, sem fechar o login', async t => {
  let closed = false;
  const ui = fixture(t, {
    onSave: async () => { throw new Error('O provedor não aceita HTTPS/CORS.'); },
    onSuccess: () => { closed = true; }
  });
  await ui.send();
  assert.equal(ui.status.hidden, false);
  assert.equal(ui.status.dataset.state, 'error');
  assert.equal(ui.status.attributes.role, 'alert');
  assert.match(ui.status.textContent, /HTTPS\/CORS/);
  assert.equal(ui.status.focused, true);
  assert.equal(ui.submit.disabled, false);
  assert.equal(ui.form.attributes['aria-busy'], 'false');
  assert.equal(closed, false);
});

test('conexão: progresso imediato, bloqueio de cliques duplicados e recuperação', async t => {
  let reject;
  let calls = 0;
  const pending = new Promise((_resolve, no) => { reject = no; });
  const ui = fixture(t, { onSave: () => { calls++; return pending; } });
  const first = ui.send();
  assert.equal(ui.submit.disabled, true);
  assert.equal(ui.submit.textContent, 'Conectando…');
  assert.equal(ui.status.dataset.state, 'pending');
  assert.equal(ui.form.attributes['aria-busy'], 'true');
  assert.ok(ui.buttons.every(button => button.disabled));
  await ui.send();
  assert.equal(calls, 1);
  reject(new Error('O servidor demorou demais para responder.'));
  await first;
  assert.equal(ui.submit.disabled, false);
  assert.ok(ui.buttons.every(button => !button.disabled));
  assert.match(ui.status.textContent, /demorou/);
});

test('conexão: FormData com falha também libera botão e exibe erro', async t => {
  const ui = fixture(t);
  t.mock.method(globalThis, 'FormData', function () { throw new Error('Não foi possível ler os campos.'); });
  await ui.send();
  assert.equal(ui.status.dataset.state, 'error');
  assert.equal(ui.submit.disabled, false);
  assert.match(ui.status.textContent, /campos/);
});

test('conexão: sucesso encaminha campos corretos, sem aparar a senha', async t => {
  let received;
  let success = false;
  const ui = fixture(t, {
    values: { username: ' teste ', password: ' senha com espaços ' },
    onSave: async draft => { received = draft; }, onSuccess: () => { success = true; }
  });
  await ui.send();
  assert.equal(received.username, 'teste');
  assert.equal(received.password, ' senha com espaços ');
  assert.equal(success, true);
});

test('conexão: transição concorrente não fecha formulário como falso sucesso', async t => {
  let closed = false;
  const ui = fixture(t, { onSave: async () => false, onSuccess: () => { closed = true; } });
  await ui.send();
  assert.equal(closed, false);
  assert.equal(ui.status.dataset.state, 'error');
});

test('M3U local: mantém leitura do arquivo e mostra erros de leitura/quota', async t => {
  let received;
  const ui = fixture(t, { type: 'm3u', values: { playlistFile: { size: 30, text: async () => '#EXTM3U' } }, onSave: async draft => { received = draft; } });
  await ui.send();
  assert.equal(received.playlistText, '#EXTM3U');
  ui.form.values.playlistFile = { size: 51 * 1024 * 1024 };
  await ui.send();
  assert.match(ui.status.textContent, /50 MB/);
  assert.equal(ui.submit.disabled, false);
});
