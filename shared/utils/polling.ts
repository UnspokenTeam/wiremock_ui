// A completed poll schedules the next one: slow requests never pile up.
export function createPoller(task: () => void | Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let generation = 0
  let running = false

  function stop() {
    generation++
    clearTimeout(timer)
    timer = undefined
  }

  function start(delay: number) {
    stop()
    const version = generation
    function schedule() {
      timer = setTimeout(async () => {
        if (version !== generation) return
        if (running) {
          schedule()
          return
        }
        running = true
        try {
          await task()
        } catch {
          /* The task reports connection failures. */
        } finally {
          running = false
        }
        if (version === generation) schedule()
      }, delay)
    }
    schedule()
  }

  return { start, stop }
}
