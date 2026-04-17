/** Stores the OpenClaw runtime reference for the Pulse plugin */

let _runtime: any = null;

export function setPulseRuntime(runtime: any) {
  _runtime = runtime;
}

export function getPulseRuntime() {
  if (!_runtime) {
    throw new Error("Pulse plugin runtime not initialized");
  }
  return _runtime;
}
