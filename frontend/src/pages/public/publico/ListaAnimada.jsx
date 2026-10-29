import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const reducido = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const SALIDA_MS = 220;

/**
 * Lista que anima los cambios de su contenido:
 * los elementos que se van se desvanecen, los que llegan aparecen con un fundido
 * y los que quedan se deslizan a su nueva posición (técnica FLIP, solo transform y opacity).
 * Si una búsqueda nueva llega a mitad de la animación, la anterior se termina al instante.
 */
export default function ListaAnimada({ items, clave, render, className = 'pv-lista' }) {
  const firma = items.map(clave).join('|');
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const claveRef = useRef(clave);
  claveRef.current = clave;

  const [lista, setLista] = useState(() => items.map((it) => ({ key: clave(it), estado: 'normal' })));
  const [firmaPrevia, setFirmaPrevia] = useState(firma);

  // Cambió el contenido: marcar lo que sale y sumar lo que entra (patrón "estado derivado de props")
  if (firma !== firmaPrevia) {
    setFirmaPrevia(firma);
    const nuevas = new Set(items.map(clave));
    const viejas = new Set(lista.filter((x) => x.estado !== 'sale').map((x) => x.key));
    const salen = lista.some((x) => x.estado !== 'sale' && !nuevas.has(x.key));
    if (salen && !reducido()) {
      const conSalida = lista
        .filter((x) => x.estado !== 'sale' || !nuevas.has(x.key))
        .map((x) => (nuevas.has(x.key) ? { ...x, estado: x.estado === 'sale' ? 'normal' : x.estado } : { ...x, estado: 'sale' }));
      items.forEach((it) => {
        const k = clave(it);
        if (!conSalida.some((x) => x.key === k)) conSalida.push({ key: k, estado: 'entra' });
      });
      setLista(conSalida);
    } else {
      setLista(items.map((it) => {
        const k = clave(it);
        return { key: k, estado: viejas.has(k) ? 'normal' : 'entra' };
      }));
    }
  }

  // Terminada la salida, ordenar como corresponde (los que quedan se deslizan)
  const haySalida = lista.some((x) => x.estado === 'sale');
  useEffect(() => {
    if (!haySalida) return undefined;
    const t = setTimeout(() => {
      setLista((prev) => {
        const entraban = new Set(prev.filter((x) => x.estado === 'entra').map((x) => x.key));
        return itemsRef.current.map((it) => {
          const k = claveRef.current(it);
          return { key: k, estado: entraban.has(k) ? 'entra' : 'normal' };
        });
      });
    }, SALIDA_MS);
    return () => clearTimeout(t);
  }, [haySalida]);

  // FLIP: medir con offsetTop/offsetLeft (no cambia al hacer scroll) y animar el desplazamiento
  const nodos = useRef(new Map());
  const posiciones = useRef(new Map());
  useLayoutEffect(() => {
    const animar = !reducido();
    const lecturas = [];
    nodos.current.forEach((el, k) => {
      if (!el) return;
      lecturas.push({ el, k, top: el.offsetTop, left: el.offsetLeft });
    });
    const mover = [];
    lecturas.forEach(({ el, k, top, left }) => {
      const antes = posiciones.current.get(k);
      if (animar && antes && (antes.top !== top || antes.left !== left)) mover.push({ el, dx: antes.left - left, dy: antes.top - top });
    });
    posiciones.current = new Map(lecturas.map(({ k, top, left }) => [k, { top, left }]));
    if (!mover.length) return;
    mover.forEach(({ el, dx, dy }) => {
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    void document.body.offsetWidth;
    mover.forEach(({ el }) => {
      el.style.transition = 'transform .5s var(--curva)';
      el.style.transform = '';
      el.addEventListener('transitionend', () => { el.style.transition = ''; }, { once: true });
    });
  }, [lista]);

  // Datos frescos de cada elemento (los que se están yendo conservan su último dato)
  const ultimo = useRef(new Map());
  items.forEach((it) => ultimo.current.set(clave(it), it));

  return (
    <div className={className}>
      {lista.map(({ key, estado }) => {
        const it = ultimo.current.get(key);
        if (!it) return null;
        return (
          <div
            key={key}
            className={`pv-item ${estado === 'sale' ? 'sale' : estado === 'entra' ? 'entra' : ''}`}
            ref={(el) => { if (el) nodos.current.set(key, el); else nodos.current.delete(key); }}
          >
            {render(it)}
          </div>
        );
      })}
    </div>
  );
}
