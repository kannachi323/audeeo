import type { Segment } from "./pipeline";
export type HistoryOperation =
  | { kind: "segment"; segment: Segment; startedAt?: string; historyGeneration?: number }
  | { kind: "complete"; sessionId: string }
  | { kind: "delete"; sessionId: string };
export interface TextStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface HistoryRemote {
  write(owner: string, segments: Segment[], startedAt?: string, historyGeneration?: number): Promise<void>;
  delete(owner: string, sessionId: string): Promise<void>;
}
/** Each identity has its own outbox. Flush never migrates data to the currently signed-in user. */
export class HistoryOutbox {
  private running?: Promise<void>;
  private key: string;
  private epoch = 0;
  constructor(
    readonly owner: string,
    private storage: TextStorage,
    private remote: HistoryRemote,
    private currentOwner: () => string | undefined,
  ) {
    this.key = `audeeo.history.${owner}`;
  }
  private read(): HistoryOperation[] {
    return JSON.parse(this.storage.getItem(this.key) || "[]");
  }
  private write(ops: HistoryOperation[]) {
    const text = JSON.stringify(ops);
    if (ops.length > 20000 || text.length > 20_000_000)
      throw new Error(
        "Offline history is full. Reconnect to sync before continuing.",
      );
    this.storage.setItem(this.key, text);
  }
  enqueue(segment: Segment, startedAt?: string, historyGeneration?: number) {
    if (!segment.final) return;
    const ops = this.read();
    if (
      ops.some((o) => o.kind === "delete" && o.sessionId === segment.sessionId)
    )
      return;
    const existingStart = ops.find(o => o.kind === "segment" && o.segment.sessionId === segment.sessionId && o.startedAt);
    startedAt ??= existingStart?.kind === "segment" ? existingStart.startedAt : undefined;
    startedAt = segment.sessionStartedAt ?? startedAt;
    historyGeneration = segment.historyGeneration ?? historyGeneration ?? (existingStart?.kind === 'segment' ? existingStart.historyGeneration : undefined);
    const index = ops.findIndex(
      (o) => o.kind === "segment" && o.segment.id === segment.id,
    );
    if (index >= 0) {
      const old = (ops[index] as { kind: "segment"; segment: Segment }).segment;
      if (
        old.revision > segment.revision ||
        (old.revision === segment.revision &&
          old.state === "complete" &&
          segment.state !== "complete")
      )
        return;
      ops[index] = { kind: "segment", segment, ...(startedAt ? { startedAt } : {}), ...(historyGeneration ? {historyGeneration} : {}) };
    } else ops.push({ kind: "segment", segment, ...(startedAt ? { startedAt } : {}), ...(historyGeneration ? {historyGeneration} : {}) });
    this.write(ops);
  }
  deleteSession(sessionId: string) {
    this.write([
      ...this.read().filter((o) =>
        o.kind === "segment"
          ? o.segment.sessionId !== sessionId
          : o.sessionId !== sessionId,
      ),
      { kind: "delete", sessionId },
    ]);
  }
  /** Called only after recording stops (or when recovering an interrupted local session). */
  completeSessions() {
    const ops = this.read();
    for (const operation of [...ops]) {
      if (operation.kind !== "segment") continue;
      const sessionId = operation.segment.sessionId;
      if (!ops.some(o => o.kind === "complete" && o.sessionId === sessionId))
        ops.push({ kind: "complete", sessionId });
    }
    this.write(ops);
  }
  flush(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.drain().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async drain() {
    const epoch=this.epoch;
    while (this.currentOwner() === this.owner) {
      const ops = this.read();
      const operation = ops.find(o => o.kind === "delete" || o.kind === "complete");
      if (!operation) return; // Active recordings are local drafts, never uploaded.
      if (operation.kind === "delete") {
        await this.remote.delete(this.owner, operation.sessionId);
        if(epoch!==this.epoch)return;
        this.write(this.read().filter(o => JSON.stringify(o) !== JSON.stringify(operation)));
        continue;
      }
      if (operation.kind !== "complete") continue;
      const sent = ops.filter((o): o is Extract<HistoryOperation, {kind:"segment"}> =>
        o.kind === "segment" && o.segment.sessionId === operation.sessionId);
      if (sent.length) await this.remote.write(this.owner, sent.map(o => o.segment), sent[0].startedAt, sent[0].historyGeneration);
      if(epoch!==this.epoch)return;
      // Remove only acknowledged versions. A newer revision or deletion may
      // have arrived while the completed document was uploading.
      const acknowledged = new Set(sent.map(o => JSON.stringify(o)));
      let remaining = this.read().filter(o => !acknowledged.has(JSON.stringify(o)));
      if (!remaining.some(o => o.kind === "segment" && o.segment.sessionId === operation.sessionId))
        remaining = remaining.filter(o => o.kind !== "complete" || o.sessionId !== operation.sessionId);
      this.write(remaining);
    }
  }
  get pending() {
    return this.read().filter(o => o.kind !== "complete").length;
  }
  clear() {
    this.epoch++;
    this.storage.removeItem(this.key);
  }
  prune(generation: number, now=Date.now()) {
    const before=this.read();
    let kept=before.filter(op=>op.kind!=='segment' || ((op.historyGeneration ?? op.segment.historyGeneration ?? 1)===generation &&
      Number.isFinite(Date.parse(op.startedAt ?? op.segment.sessionStartedAt ?? '')) && Date.parse(op.startedAt ?? op.segment.sessionStartedAt!)>now-30*86400000));
    const sessions=new Set(kept.flatMap(op=>op.kind==='segment' ? [op.segment.sessionId] : []));
    kept=kept.filter(op=>op.kind!=='complete' || sessions.has(op.sessionId));
    if(kept.length!==before.length){this.epoch++;this.write(kept);}
  }
}
