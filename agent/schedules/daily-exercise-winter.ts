import { defineSchedule } from "eve/schedules";

import { runDailyExerciseJob } from "../lib/daily-exercise-job";

// 08:00 UTC is 09:00 in Budapest during winter time (CET). The job itself
// sends only when it is 9 in Budapest, so this run is skipped in summer.
export default defineSchedule({
  cron: "0 8 * * *",
  run({ waitUntil }) {
    waitUntil(runDailyExerciseJob());
  },
});
