import type { Segment } from "./pipeline";
export type HistoryOperation =
  | { kind: "segment"; segment: Segment }
  | { kind: "delete"; sessionId: string };
export interface TextStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface HistoryRemote {
  write(owner: string, segment: Segment): Promise<void>;
  delete(owner: string, sessionId: string): Promise<void>;
}
/** Each identity has its own outbox. Flush never migrates data to the currently signed-in user. */
export class HistoryOutbox {
  private running?: Promise<void>;
  private key: string;
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
    if (ops.length > 1000 || text.length > 2_000_000)
      throw new Error(
        "Offline history is full. Reconnect to sync before continuing.",
      );
    this.storage.setItem(this.key, text);
  }
  enqueue(segment: Segment) {
    if (!segment.final) return;
    const ops = this.read();
    if (
      ops.some((o) => o.kind === "delete" && o.sessionId === segment.sessionId)
    )
      return;
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
      ops[index] = { kind: "segment", segment };
    } else ops.push({ kind: "segment", segment });
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
  flush(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.drain().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async drain() {
    while (this.currentOwner() === this.owner) {
      const operation = this.read()[0];
      if (!operation) return;
      if (operation.kind === "delete")
        await this.remote.delete(this.owner, operation.sessionId);
      else await this.remote.write(this.owner, operation.segment);
      // Only remove the exact version sent; revisions/deletion may arrive during the await.
      const ops = this.read();
      const index = ops.findIndex(
        (o) => JSON.stringify(o) === JSON.stringify(operation),
      );
      if (index >= 0) {
        ops.splice(index, 1);
        this.write(ops);
      }
    }
  }
  get pending() {
    return this.read().length;
  }
  clear() {
    this.storage.removeItem(this.key);
  }
}
