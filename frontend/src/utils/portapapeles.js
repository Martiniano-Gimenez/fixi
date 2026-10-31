export async function copiarTexto(texto) {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      // Si el navegador rechaza la API moderna, intentá la copia compatible con HTTP.
    }
  }

  const textarea = document.createElement('textarea');
  const focoAnterior = document.activeElement;
  textarea.value = texto;
  textarea.readOnly = true;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  textarea.style.fontSize = '16px';

  try {
    document.body.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(0, texto.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
    focoAnterior?.focus?.({ preventScroll: true });
  }
}
