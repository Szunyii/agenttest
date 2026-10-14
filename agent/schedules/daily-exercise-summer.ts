import { defineSchedule } from "eve/schedules";

import { runDailyExerciseJob } from "../lib/daily-exercise-job";

// 07:00 UTC is 09:00 in Budapest during summer time (CEST). The job itself
// sends only when it is 9 in Budapest, so this run is skipped in winter.
export default defineSchedule({
  cron: "0 7 * * *",
  run({ waitUntil }) {
    waitUntil(runDailyExerciseJob());
  },
});
