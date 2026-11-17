// Monthly AWS running cost at pilot volume, from list prices (US East, N. Virginia).
// No free tier is applied, so this is the ceiling, not the best case.

export const PRICES = {
  lambdaRequestPerM: 0.2,
  lambdaArmGbSecond: 0.0000133334,
  httpApiPerM: 1.0,
  dynamoWritePerM: 0.625,
  dynamoReadPerM: 0.125,
  dynamoStorageGbMonth: 0.25,
  dynamoPitrGbMonth: 0.2,
  schedulerPerM: 1.0,
  sqsPerM: 0.4,
  s3StandardGbMonth: 0.023,
  s3PutPer1000: 0.005,
  logsIngestGb: 0.5,
  secretMonth: 0.4,
  alarmMonth: 0.1,
};

export const PRICE_SOURCES = [
  'Lambda $0.20 per million requests; arm64 $0.0000133334 per GB-second',
  'API Gateway HTTP APIs $1.00 per million requests (first 300 million)',
  'DynamoDB on-demand $0.625 per million writes, $0.125 per million reads, $0.25 per GB-month; PITR $0.20 per GB-month',
  'EventBridge Scheduler $1.00 per million invocations',
  'SQS standard $0.40 per million requests',
  'S3 Standard $0.023 per GB-month; PUT $0.005 per 1,000',
  'CloudWatch Logs ingestion $0.50 per GB; standard alarms $0.10 each',
  'Secrets Manager $0.40 per secret per month',
];

/**
 * volumes: derived from the simulated day (tasks per day) plus stated assumptions.
 * Returns { lines: [{item, assumption, monthly}], total, perDay }.
 */
export function monthlyCost({ tasksPerDay, staff = 8, days = 30, photoShare = 0.15, photoMb = 1.5, monthsOfPhotos = 12 }) {
  const interactions = tasksPerDay * 3 + staff * 4; // start, done, one extra (photo/help/outcome) + clock events
  const webhooks = 150; // Goose changes per day (assumption)
  const tickRuns = 24 * 60; // engine tick every minute
  const pollRuns = 24 * 30; // Goose poll fallback every 2 minutes
  const admin = 60;
  const lambdaCalls = (interactions * 2 + webhooks + tickRuns + pollRuns + admin + 1) * days;
  const gbSeconds = (interactions * (0.25 * 0.08 + 0.25 * 0.4) + webhooks * 0.25 * 0.2 + tickRuns * 0.25 * 0.25 + pollRuns * 0.25 * 0.4 + admin * 0.25 * 0.15) * days;
  const httpCalls = (interactions + webhooks + admin) * days;
  const writes = (tasksPerDay * 7 + staff * 4 + webhooks * 2) * days; // create, claim, start, done, idempotency x3
  const reads = (tickRuns * 15 + pollRuns * 2 + interactions * 3) * days; // tick reads the open queue (~15 RRU)
  const tableGb = (tasksPerDay * 1.5 * days * monthsOfPhotos) / 1024 / 1024; // ~1.5 KB per task, a year of history
  const schedules = (tickRuns + pollRuns + 1) * days;
  const sqs = interactions * 3 * days; // send, receive, delete
  const photoGb = (tasksPerDay * photoShare * photoMb * days * monthsOfPhotos) / 1024;
  const photoPuts = tasksPerDay * photoShare * days;
  const logsGb = (lambdaCalls * 1.2) / 1024 / 1024; // ~1.2 KB of logs per call

  const lines = [
    { item: 'Lambda requests', assumption: `${Math.round(lambdaCalls / 1000)}k calls/month`, monthly: (lambdaCalls / 1e6) * PRICES.lambdaRequestPerM },
    { item: 'Lambda compute (arm64, 256 MB)', assumption: `${Math.round(gbSeconds)} GB-seconds/month`, monthly: gbSeconds * PRICES.lambdaArmGbSecond },
    { item: 'API Gateway (HTTP API)', assumption: `${Math.round(httpCalls / 1000)}k requests/month`, monthly: (httpCalls / 1e6) * PRICES.httpApiPerM },
    { item: 'DynamoDB writes', assumption: `${Math.round(writes / 1000)}k writes/month`, monthly: (writes / 1e6) * PRICES.dynamoWritePerM },
    { item: 'DynamoDB reads', assumption: `${Math.round(reads / 1000)}k read units/month`, monthly: (reads / 1e6) * PRICES.dynamoReadPerM },
    { item: 'DynamoDB storage + point-in-time recovery', assumption: `${tableGb.toFixed(2)} GB after a year`, monthly: tableGb * (PRICES.dynamoStorageGbMonth + PRICES.dynamoPitrGbMonth) },
    { item: 'EventBridge Scheduler', assumption: `${Math.round(schedules / 1000)}k runs/month (tick + poll)`, monthly: (schedules / 1e6) * PRICES.schedulerPerM },
    { item: 'SQS queue', assumption: `${Math.round(sqs / 1000)}k requests/month`, monthly: (sqs / 1e6) * PRICES.sqsPerM },
    { item: 'S3 photos', assumption: `${photoGb.toFixed(1)} GB after a year (${Math.round(photoShare * 100)}% of tasks, ${photoMb} MB each)`, monthly: photoGb * PRICES.s3StandardGbMonth + (photoPuts / 1000) * PRICES.s3PutPer1000 },
    { item: 'CloudWatch logs', assumption: `${logsGb.toFixed(2)} GB/month`, monthly: logsGb * PRICES.logsIngestGb },
    { item: 'CloudWatch alarms', assumption: '4 alarms', monthly: 4 * PRICES.alarmMonth },
    { item: 'Secrets Manager', assumption: '1 secret (Slack + Goose keys)', monthly: PRICES.secretMonth },
  ].map((l) => ({ ...l, monthly: Math.round(l.monthly * 100) / 100 }));
  const total = Math.round(lines.reduce((a, l) => a + l.monthly, 0) * 100) / 100;
  return { lines, total, perDay: { interactions, lambdaCalls: Math.round(lambdaCalls / days) } };
}
