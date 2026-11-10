export const ROUTE_PATH = '/dsh-kkrpc';

/**
 * Transforms an RPC value type to reflect wire serialization rules.
 * Functions and closures cannot be serialized over RPC and arrive as `undefined`.
 */
export type CleanRPCValue<T> = T extends (...args: any[]) => any
  ? undefined
  : T extends (infer U)[]
    ? CleanRPCValue<U>[]
    : T extends readonly (infer U)[]
      ? readonly CleanRPCValue<U>[]
      : T extends Record<string, any>
        ? { [K in keyof T]: CleanRPCValue<T[K]> }
        : T;

export type Promisify<T> = {
  [K in keyof T]: T[K] extends (...args: infer Args) => infer R
    ? (...args: Args) => Promise<CleanRPCValue<Awaited<R>>>
    : T[K] extends Record<string, any>
      ? Promisify<T[K]>
      : Promise<CleanRPCValue<Awaited<T[K]>>>;
};

export interface IKkRPCService {
  getAPI<T extends Record<string, any> = Record<string, any>>(namespace: string): Promisify<T>;
  exposeAPI<T extends Record<string, any>>(namespace: string, api: T): () => void;
}
