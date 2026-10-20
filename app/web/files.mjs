import { sanitizeBackup } from './backup.mjs';

export function validateBackup(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || ![1, 2, 3, 4, 5, 6].includes(data.version)) {
    throw new Error('Backup inválido. Use um arquivo MTPLAYER de versão 1 a 6.');
  }
  return sanitizeBackup(data);
}

export function createFileAPI() {
  return Object.freeze({
    export: async data => {
      const safe = validateBackup(data);
      const url = URL.createObjectURL(new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `mtplayer-web-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return true;
    },
    import: async () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.hidden = true;
      document.body.append(input);
      try {
        const file = await new Promise(resolve => {
          input.addEventListener('change', () => resolve(input.files?.[0] || null), { once: true });
          input.addEventListener('cancel', () => resolve(null), { once: true });
          input.click();
        });
        if (!file) return null;
        if (file.size > 10 * 1024 * 1024) throw new Error('O backup excede 10 MB.');
        let data;
        try { data = JSON.parse(await file.text()); }
        catch { throw new Error('O arquivo não contém JSON válido.'); }
        return validateBackup(data);
      } finally { input.remove(); }
    }
  });
}
