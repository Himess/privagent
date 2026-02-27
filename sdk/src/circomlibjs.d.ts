declare module "circomlibjs" {
  export type Poseidon = {
    (inputs: bigint[]): Uint8Array;
    F: any;
  };
  export function buildPoseidon(): Promise<Poseidon>;
}
