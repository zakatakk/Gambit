/** Tiny DOM helpers. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | ((e: Event) => void)> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') {
      n.addEventListener(k.replace(/^on/, '').toLowerCase(), v as EventListener);
    } else if (typeof v === 'boolean') {
      if (v) n.setAttribute(k, '');
    } else if (k === 'class') {
      n.className = v;
    } else {
      n.setAttribute(k, v);
    }
  }
  for (const c of children) {
    if (c == null) continue;
    n.append(c instanceof Node ? c : document.createTextNode(c));
  }
  return n;
}

let toastTimer: number | undefined;
export function toast(msg: string): void {
  document.querySelector('.toast')?.remove();
  const t = el('div', { class: 'toast' }, msg);
  document.body.appendChild(t);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.remove(), 2600);
}

/** Bottom-sheet modal; returns close(). */
export function modal(...content: Node[]): () => void {
  const back = el('div', { class: 'modal-back' });
  const sheet = el('div', { class: 'modal' }, ...content);
  back.appendChild(sheet);
  back.addEventListener('pointerdown', (e) => {
    if (e.target === back) close();
  });
  document.body.appendChild(back);
  function close(): void {
    back.remove();
  }
  return close;
}

export function switchControl(checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = el('input', { type: 'checkbox' }) as HTMLInputElement;
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'switch' }, input, el('span', { class: 'track' }));
}
