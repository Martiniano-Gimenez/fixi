import { useEffect, useState, useCallback } from 'react';

/**
 * Draws SVG connector lines between bracket rounds.
 * 
 * It reads the actual DOM positions of `.match-card` elements
 * inside `.bracket-section` columns and draws curved paths
 * connecting each pair of matches to their next-round match.
 * 
 * Props:
 *   containerRef - ref to the .bracket-scroll element
 *   fases        - array of fases (to re-render when data changes)
 */
export default function BracketLines({ containerRef, fases }) {
  const [lines, setLines] = useState([]);

  const computeLines = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const sections = container.querySelectorAll('.bracket-section');
    if (sections.length < 2) return;

    const containerRect = container.getBoundingClientRect();
    const scrollLeft = container.scrollLeft;
    const scrollTop = container.scrollTop;

    const newLines = [];

    for (let i = 0; i < sections.length - 1; i++) {
      const currentSection = sections[i];
      const nextSection = sections[i + 1];

      const currentCards = currentSection.querySelectorAll('.match-card');
      const nextCards = nextSection.querySelectorAll('.match-card');

      if (currentCards.length === 0 || nextCards.length === 0) continue;

      // Each pair of matches in currentCards feeds into one match in nextCards
      for (let j = 0; j < nextCards.length; j++) {
        const topIdx = j * 2;
        const botIdx = j * 2 + 1;

        const nextCard = nextCards[j];
        const nextRect = nextCard.getBoundingClientRect();

        // Target point: left-center of next card
        const targetX = nextRect.left - containerRect.left + scrollLeft;
        const targetY = nextRect.top + nextRect.height / 2 - containerRect.top + scrollTop;

        // Helper to get right-center of a card
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

          // Horizontal gap midpoint
          const midX = (from.x + targetX) / 2;

          // Path: from right of source -> horizontal to midX -> vertical to target Y -> horizontal to target
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
  }, [containerRef, fases]);

  useEffect(() => {
    // Compute after DOM paint — give extra time for fixed-size cards to layout
    const timer = setTimeout(computeLines, 200);

    // Recompute on window resize
    window.addEventListener('resize', computeLines);

    // Recompute on horizontal scroll inside the bracket container
    const container = containerRef.current;
    if (container) {
      container.addEventListener('scroll', computeLines);
    }

    // Recompute when the container itself resizes (e.g. cards change size)
    let resizeObserver;
    if (container && typeof ResizeObserver !== 'undefined') {
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
  }, [computeLines, containerRef]);

  // Also recompute when fases data changes
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
          stroke="var(--color-text-muted)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
