export type SeatAbsenceView = {
  seatId: string;
  phase: "reconnecting" | "absent" | "timed_out" | "present";
  remainingMs: number;
  deadlineAt: number | null;
};

export type AbsenceDispositionAction =
  | "extend_wait"
  | "technical_abort"
  | "force_eliminate";

type AbsenceDrawerProps = {
  absences: SeatAbsenceView[];
  seatNames: Record<string, string>;
  isHost: boolean;
  busy: boolean;
  pausedForAbsenceSeatId: string | null;
  onDisposition: (seatId: string, action: AbsenceDispositionAction) => void;
  onResume?: () => void;
  showResume?: boolean;
};

function formatWait(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function copyFor(
  absence: SeatAbsenceView,
  who: string,
  paused: boolean,
): { title: string; body: string } {
  if (absence.phase === "reconnecting") {
    return {
      title: `${who} 重连中`,
      body: `实时通道断开，宽限 ${formatWait(absence.remainingMs)}。未轮到该座时其他座位可继续。`,
    };
  }
  if (absence.phase === "absent") {
    return {
      title: `${who} 已离席`,
      body: paused
        ? `软超时剩余 ${formatWait(absence.remainingMs)}。正轮到该座，对局在此决策点暂停。`
        : `软超时剩余 ${formatWait(absence.remainingMs)}。若正轮到该座，对局将在此决策点暂停。`,
    };
  }
  return {
    title: `${who} 等待超时`,
    body: "主机须选择：继续等待 / 技术中止 / 强制揭示淘汰。",
  };
}

export function AbsenceDrawer({
  absences,
  seatNames,
  isHost,
  busy,
  pausedForAbsenceSeatId,
  onDisposition,
  onResume,
  showResume,
}: AbsenceDrawerProps) {
  const visible = absences.filter((a) => a.phase !== "present");
  if (visible.length === 0 && !showResume) return null;

  return (
    <section className="absence-drawer" aria-label="离席与回席">
      <div className="rail-title">
        <span>离席等待</span>
        <span>{visible.length} 座</span>
      </div>
      {visible.map((absence) => {
        const who = seatNames[absence.seatId] ?? `座位 ${absence.seatId}`;
        const paused = pausedForAbsenceSeatId === absence.seatId;
        const copy = copyFor(absence, who, paused);
        const canDispose =
          isHost &&
          (absence.phase === "absent" || absence.phase === "timed_out");
        return (
          <div
            key={absence.seatId}
            className={`absence-card absence-${absence.phase}`}
          >
            <strong>{copy.title}</strong>
            <p>{copy.body}</p>
            {canDispose ? (
              <div className="absence-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDisposition(absence.seatId, "extend_wait")}
                >
                  继续等待
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    onDisposition(absence.seatId, "technical_abort")
                  }
                >
                  技术中止
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    onDisposition(absence.seatId, "force_eliminate")
                  }
                >
                  强制揭示淘汰
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
      {showResume && onResume ? (
        <button
          type="button"
          className="absence-resume"
          disabled={busy}
          onClick={onResume}
        >
          凭座位凭证回席
        </button>
      ) : null}
    </section>
  );
}

export function absenceSeatStatus(
  absences: SeatAbsenceView[],
  seatId: string,
): string | null {
  const absence = absences.find((a) => a.seatId === seatId);
  if (!absence || absence.phase === "present") return null;
  if (absence.phase === "reconnecting") {
    return `重连中 ${formatWait(absence.remainingMs)}`;
  }
  if (absence.phase === "absent") {
    return `已离席 ${formatWait(absence.remainingMs)}`;
  }
  return "等待超时";
}
