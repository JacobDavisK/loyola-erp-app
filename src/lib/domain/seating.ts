/**
 * Examination seating (pure). Candidates of one sitting (date + slot) are spread over rooms by
 * examination seat capacity. Courses are interleaved so neighbouring seats hold different papers,
 * which makes copying harder. The plan is deterministic for a given input order.
 */

export interface SeatCandidate {
  registrationId: string;
  examinationId: string;
  /** stable ordering key, e.g. the student number */
  sortKey: string;
}

export interface SeatRoom {
  id: string;
  code: string;
  seats: number;
}

export interface SeatAssignment {
  registrationId: string;
  roomId: string;
  seatNo: number;
}

export function allocateSeats(candidates: SeatCandidate[], rooms: SeatRoom[]): { assignments: SeatAssignment[]; unseated: string[] } {
  // Group by paper, each group sorted by student number; then deal one from each group in turn.
  const groups = new Map<string, SeatCandidate[]>();
  for (const c of candidates) (groups.get(c.examinationId) ?? groups.set(c.examinationId, []).get(c.examinationId)!).push(c);
  const queues = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([, list]) => list.sort((a, b) => a.sortKey.localeCompare(b.sortKey)));
  const order: SeatCandidate[] = [];
  let remaining = candidates.length;
  let i = 0;
  while (remaining > 0) {
    const q = queues[i % queues.length];
    const next = q.shift();
    if (next) {
      order.push(next);
      remaining--;
    }
    i++;
  }
  const assignments: SeatAssignment[] = [];
  let cursor = 0;
  for (const room of rooms) {
    for (let seat = 1; seat <= room.seats && cursor < order.length; seat++) assignments.push({ registrationId: order[cursor++].registrationId, roomId: room.id, seatNo: seat });
    if (cursor >= order.length) break;
  }
  return { assignments, unseated: order.slice(cursor).map((c) => c.registrationId) };
}

/** Invigilators needed for a room: one per `perInvigilator` candidates, at least one. */
export function invigilatorsNeeded(candidates: number, perInvigilator = 30) {
  return candidates === 0 ? 0 : Math.max(1, Math.ceil(candidates / perInvigilator));
}
