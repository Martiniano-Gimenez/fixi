const primeros = Array.from({ length: 7 }, (_, i) => ({ parejaId: `1${String.fromCharCode(65+i)}`, pareja: {}, zonaOrigen: String.fromCharCode(65+i) }));
const segundos = Array.from({ length: 7 }, (_, i) => ({ parejaId: `2${String.fromCharCode(65+i)}`, pareja: {}, zonaOrigen: String.fromCharCode(65+i) }));
const otros = [];
const clasificadas = [...primeros, ...segundos, ...otros];

const totalParejas = clasificadas.length;
const potencias = [2, 4, 8, 16, 32, 64];
let potencia = 2;
for (const p of potencias) {
  if (p >= totalParejas) { potencia = p; break; }
}

const M = potencia / 2;

function getMatchSequence(m) {
  if (m === 1) return [1];
  let seq = [1, 2];
  let currentM = 2;
  while (currentM < m) {
    const nextSeq = [];
    const sum = currentM * 2 + 1;
    for (const val of seq) {
      if (val % 2 !== 0) nextSeq.push(val, sum - val);
      else nextSeq.push(sum - val, val);
    }
    seq = nextSeq;
    currentM *= 2;
  }
  return seq;
}

const seq = getMatchSequence(M);
const matchSlots = Array.from({ length: M }, () => ({ p1: null, p2: null }));

for (let i = 0; i < primeros.length; i++) {
  if (i < M) {
    const matchIdx = seq[i] - 1;
    matchSlots[matchIdx].p1 = primeros[i];
  }
}

const numByes = potencia - totalParejas;
for (let i = 0; i < numByes; i++) {
  if (i < M) {
    const matchIdx = seq[i] - 1;
    matchSlots[matchIdx].p2 = { isBye: true };
  }
}

const restoClasificados = [...segundos, ...otros];
for (let i = 0; i < restoClasificados.length; i++) {
  const equipo = restoClasificados[i];
  const idealSeqIdx = i ^ 1; 
  let placed = false;

  if (idealSeqIdx < M) {
    const idealMatchIdx = seq[idealSeqIdx] - 1;
    if (matchSlots[idealMatchIdx].p2 === null) {
      matchSlots[idealMatchIdx].p2 = equipo;
      placed = true;
    }
  }

  if (!placed) {
    const firstMatchIdx = i < seq.length ? seq[i] - 1 : 0;
    const isFirstTopHalf = firstMatchIdx < M / 2;

    const searchIndices = [];
    for (let k = 0; k < M; k++) {
      const idx = seq[k] - 1;
      const isIdxTopHalf = idx < M / 2;
      if (isIdxTopHalf !== isFirstTopHalf) {
        searchIndices.push(idx);
      }
    }

    for (const idx of searchIndices) {
      if (matchSlots[idx].p1 !== null && matchSlots[idx].p2 === null) {
        matchSlots[idx].p2 = equipo;
        placed = true;
        break;
      }
    }

    if (!placed) {
      for (const idx of searchIndices) {
        if (matchSlots[idx].p1 === null) {
          matchSlots[idx].p1 = equipo;
          placed = true;
          break;
        }
      }
    }

    if (!placed) {
      for (let j = 0; j < M; j++) {
        if (matchSlots[j].p1 === null) { matchSlots[j].p1 = equipo; placed = true; break; }
        if (matchSlots[j].p2 === null) { matchSlots[j].p2 = equipo; placed = true; break; }
      }
    }
  }
}

console.log(`Bracket para ${totalParejas} equipos (M=${M}):`);
for (let i=0; i<M; i++) {
  const p1 = matchSlots[i].p1?.parejaId || (matchSlots[i].p1?.isBye ? 'BYE' : '---');
  const p2 = matchSlots[i].p2?.parejaId || (matchSlots[i].p2?.isBye ? 'BYE' : '---');
  console.log(`M${i+1}: ${p1} vs ${p2}`);
}
