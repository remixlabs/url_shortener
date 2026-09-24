type WorkerEnv = import("../src/index").Env;

declare namespace Cloudflare {
  interface Env extends WorkerEnv {}
}
