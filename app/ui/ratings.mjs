export function mountRatings(container, item, { getRating, onRate } = {}) {
  if (!container || !onRate) return;
  const group = document.createElement('div');
  group.className = 'title-ratings';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Sua avaliação');
  for (const [value, label, symbol] of [[1, 'Gostei', '👍'], [2, 'Amei', '♥'], [-1, 'Não é para mim', '👎']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.ratingValue = String(value);
    button.textContent = symbol;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.onclick = () => {
      onRate(item, getRating?.(item) === value ? 0 : value);
      refresh();
    };
    group.append(button);
  }
  function refresh() {
    for (const button of group.querySelectorAll('button')) {
      const selected = getRating?.(item) === Number(button.dataset.ratingValue);
      button.setAttribute('aria-pressed', String(selected));
      button.title = `${button.getAttribute('aria-label')}${selected ? ' • clique para desfazer' : ''}`;
    }
  }
  refresh();
  container.append(group);
}
