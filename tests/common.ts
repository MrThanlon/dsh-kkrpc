import { RPCMessage, Transport } from "@mrthanlon/kkrpc";

class MemoryTransport implements Transport<RPCMessage> {
  capabilities = { objectMode: true, transfer: true, remoteRefs: true };
  closed = false;
  peer?: MemoryTransport;
  postError?: Error;
  asyncPostError?: Error;
  asyncPostErrorDelay = 0;
  messages: RPCMessage[] = [];
  transfers: Transferable[][] = [];
  private listeners = new Set<(message: RPCMessage) => void>();

  send(
    message: RPCMessage,
    transfers: Transferable[] = [],
  ): void | Promise<void> {
    if (this.postError) throw this.postError;
    this.messages.push(message);
    this.transfers.push(transfers);
    queueMicrotask(() => {
      for (const listener of this.peer?.listeners ?? []) listener(message);
    });
    if (this.asyncPostError) {
      return new Promise((_, reject) => {
        setTimeout(() => reject(this.asyncPostError), this.asyncPostErrorDelay);
      });
    }
  }

  subscribe(listener: (message: RPCMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
  }
}

export function createPair(): [MemoryTransport, MemoryTransport] {
  const a = new MemoryTransport();
  const b = new MemoryTransport();
  a.peer = b;
  b.peer = a;
  return [a, b];
}
