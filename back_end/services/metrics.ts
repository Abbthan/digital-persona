import { getDb } from "@/back_end/services/db";

const METRIC_ID = "global";

type MetricDelta = { personasCreated?: number; messagesExchanged?: number };

// The upsert means fresh databases and deployments that briefly race the
// migration still retain counts instead of rejecting an otherwise-valid user
// action. Existing migrated counters are only incremented.
export async function incrementPlatformMetrics(delta: MetricDelta) {
  const personasCreated = delta.personasCreated ?? 0;
  const messagesExchanged = delta.messagesExchanged ?? 0;
  if (personasCreated === 0 && messagesExchanged === 0) return;
  await getDb().platformMetric.upsert({
    where: { id: METRIC_ID },
    create: { id: METRIC_ID, personasCreated, messagesExchanged },
    update: {
      personasCreated: { increment: personasCreated },
      messagesExchanged: { increment: messagesExchanged },
    },
  });
}
