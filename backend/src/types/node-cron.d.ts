declare module "node-cron" {
  function schedule(expression: string, func: () => void | Promise<void>): { stop: () => void };
  export default { schedule };
}
