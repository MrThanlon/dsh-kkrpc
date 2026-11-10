export const ROUTE_PATH = '/dsh-kkrpc';

export type Promisify<T> = {
  [K in keyof T]: T[K] extends (...args: infer Args) => infer R
    ? (...args: Args) => R extends Promise<any> ? R : Promise<R>
    : T[K] extends Record<string, any>
      ? Promisify<T[K]>
      : Promise<T[K]>;
};

export interface IKkRPCService {
  getAPI<T extends Record<string, any> = Record<string, any>>(namespace: string): Promisify<T>;
  exposeAPI<T extends Record<string, any>>(namespace: string, api: T): () => void;
}
