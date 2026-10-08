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
  return openSheet(content);
}

/** Shared sheet opener. `onDismiss` runs when the backdrop is tapped. */
function openSheet(content: Node[], onDismiss?: () => void): () => void {
  const back = el('div', { class: 'modal-back' });
  const sheet = el('div', { class: 'modal' }, ...content);
  back.appendChild(sheet);
  back.addEventListener('pointerdown', (e) => {
    if (e.target !== back) return;
    close();
    onDismiss?.();
  });
  document.body.appendChild(back);
  function close(): void {
    back.remove();
  }
  return close;
}

/**
 * In-app confirmation sheet, used instead of window.confirm().
 * Resolves true only when the confirm button is pressed. Escape, Cancel,
 * and a backdrop tap resolve false. Cancel has focus when the sheet opens,
 * and focus returns to the previously focused control when it closes.
 */
export function confirmSheet(opts: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKey);
      close();
      returnFocus?.focus();
      resolve(value);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') finish(false);
    };
    const cancel = el('button', { onclick: () => finish(false) }, 'Cancel');
    const ok = el('button', { class: opts.danger ? 'danger' : 'primary', onclick: () => finish(true) }, opts.confirmLabel);
    const close = openSheet(
      [
        el('h2', {}, opts.title),
        el('p', { class: 'muted' }, opts.message),
        el('div', { class: 'btn-row' }, cancel, ok),
      ],
      () => finish(false)
    );
    document.addEventListener('keydown', onKey);
    cancel.focus();
  });
}

export function switchControl(checked: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = el('input', { type: 'checkbox' }) as HTMLInputElement;
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'switch' }, input, el('span', { class: 'track' }));
}
