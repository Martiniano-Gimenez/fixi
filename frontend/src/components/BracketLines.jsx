import { useEffect, useState, useCallback } from 'react';

/**
 * Dibuja líneas SVG conectoras entre rondas del bracket eliminatorio.
 * selectorRonda, selectorPartido y color son opcionales: por defecto, los del panel
 * (.bracket-section, .match-card); la vista pública v2 pasa los suyos.
 */
export default function BracketLines({
  containerRef,
  scrollContainerRef,
  fases = [],
  selectorRonda = '.bracket-section',
  selectorPartido = '.match-card',
  color = 'var(--color-border)',
}) {
  const [lines, setLines] = useState([]);
  const activeRef = containerRef || scrollContainerRef;

  const computeLines = useCallback(() => {
    const container = activeRef?.current;
    if (!container) return;

    const sections = container.querySelectorAll(selectorRonda);
    if (sections.length < 2) {
      setLines([]);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const scrollLeft = container.scrollLeft;
    const scrollTop = container.scrollTop;

    const newLines = [];

    for (let i = 0; i < sections.length - 1; i++) {
      const currentSection = sections[i];
      const nextSection = sections[i + 1];

      const currentCards = currentSection.querySelectorAll(selectorPartido);
      const nextCards = nextSection.querySelectorAll(selectorPartido);

      if (currentCards.length === 0 || nextCards.length === 0) continue;

      for (let j = 0; j < nextCards.length; j++) {
        const topIdx = j * 2;
        const botIdx = j * 2 + 1;

        const nextCard = nextCards[j];
        const nextRect = nextCard.getBoundingClientRect();

        const targetX = nextRect.left - containerRect.left + scrollLeft;
        const targetY = nextRect.top + nextRect.height / 2 - containerRect.top + scrollTop;

        const getRightCenter = (card) => {
          const r = card.getBoundingClientRect();
          return {
            x: r.right - containerRect.left + scrollLeft,
            y: r.top + r.height / 2 - containerRect.top + scrollTop,
          };
        };

        if (topIdx < currentCards.length) {
          const topCard = currentCards[topIdx];
          const from = getRightCenter(topCard);
          const midX = (from.x + targetX) / 2;
          const path = `M ${from.x} ${from.y} H ${midX} V ${targetY} H ${targetX}`;
          newLines.push(path);
        }

        if (botIdx < currentCards.length) {
          const botCard = currentCards[botIdx];
          const from = getRightCenter(botCard);
          const midX = (from.x + targetX) / 2;
          const path = `M ${from.x} ${from.y} H ${midX} V ${targetY} H ${targetX}`;
          newLines.push(path);
        }
      }
    }

    setLines(newLines);
  }, [activeRef, fases, selectorRonda, selectorPartido]);

  useEffect(() => {
    const container = activeRef?.current;
    if (!container) return;

    const timer = setTimeout(computeLines, 200);

    window.addEventListener('resize', computeLines);
    container.addEventListener('scroll', computeLines);

    let resizeObserver;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        computeLines();
      });
      resizeObserver.observe(container);
    }

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', computeLines);
      if (container) {
        container.removeEventListener('scroll', computeLines);
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [computeLines, activeRef]);

  useEffect(() => {
    const timer = setTimeout(computeLines, 250);
    return () => clearTimeout(timer);
  }, [fases, computeLines]);

  if (lines.length === 0) return null;

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      {lines.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
