#!/usr/bin/env node
/**
 * Fetch the public GitHub contribution calendar for the portfolio.
 *
 * Data contract (shared with scripts/fetch-leetcode-activity.mjs):
 * {
 *   "schemaVersion": 1,
 *   "platform": "github",
 *   "username": "vishnu-s-tripathi06",
 *   "unit": "contributions",
 *   "status": "ok",
 *   "generatedAt": "2026-11-22T00:00:00.000Z",
 *   "range": { "start": "2025-11-23", "end": "2026-11-22" },
 *   "total": 123,
 *   "activeDays": 45,
 *   "days": [{ "date": "2025-11-23", "count": 0 }]
 * }
 *
 * `total` is the sum of `days[].count` and is never combined with LeetCode
 * submission counts. `generatedAt` is only advanced when the dataset changes.
 * `status` is "ok" for fetched data and "pending" for the initial placeholder
 * that is replaced by the first successful GitHub Actions run.
 *
 * Authentication:
 *   GITHUB_TOKEN must be present. In GitHub Actions this is the automatically
 *   provided token (`${{ github.token }}`), not a personal access token.
 *
 * Failure behavior:
 *   The script validates the complete dataset before writing. If the fetch,
 *   parsing, or validation fails, the existing data file is left untouched.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLATFORM = 'github';
const USERNAME = 'vishnu-s-tripathi06';
const UNIT = 'contributions';
const SCHEMA_VERSION = 1;
const DAY_COUNT = 365;
const DATA_PATH = fileURLToPath(
  new URL('../data/github-activity.json', import.meta.url)
);
const GRAPHQL_URL = 'https://api.github.com/graphql';

const QUERY = `query ContributionCalendar(
  $login: String!
  $from: DateTime!
  $to: DateTime!
) {
  user(login: $login) {
    contributionsCollection(from: $from, to: $to) {
      totalContributions
      contributionCalendar {
        weeks {
          contributionDays {
            date
            contributionCount
          }
        }
      }
    }
  }
}`;

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateString, amount) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return toDateString(date);
}

function isDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && toDateString(date) === value;
}

function buildDays(counts, startDate, endDate) {
  const days = [];

  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    days.push({ date, count: counts.get(date) ?? 0 });
  }

  return days;
}

function validateDataset(data) {
  const fail = (message) => {
    throw new Error(`Invalid GitHub activity dataset: ${message}`);
  };

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    fail('root must be an object');
  }

  if (data.schemaVersion !== SCHEMA_VERSION) fail('schemaVersion');
  if (data.platform !== PLATFORM) fail('platform');
  if (data.username !== USERNAME) fail('username');
  if (data.unit !== UNIT) fail('unit');
  if (data.status !== 'ok' && data.status !== 'pending') fail('status');

  if (
    typeof data.generatedAt !== 'string' ||
    Number.isNaN(Date.parse(data.generatedAt))
  ) {
    fail('generatedAt must be an ISO timestamp');
  }

  if (!data.range || typeof data.range !== 'object') fail('range');
  if (!isDateString(data.range.start) || !isDateString(data.range.end)) {
    fail('range dates must use YYYY-MM-DD');
  }
  if (data.range.start > data.range.end) fail('range.start must precede range.end');

  if (!Array.isArray(data.days) || data.days.length !== DAY_COUNT) {
    fail(`days must contain exactly ${DAY_COUNT} records`);
  }

  let total = 0;
  let activeDays = 0;
  let previousDate = null;

  data.days.forEach((day, index) => {
    if (!day || typeof day !== 'object' || Array.isArray(day)) {
      fail(`days[${index}] must be an object`);
    }
    if (!isDateString(day.date)) {
      fail(`days[${index}].date must use YYYY-MM-DD`);
    }
    if (previousDate !== null && addDays(previousDate, 1) !== day.date) {
      fail(`days[${index}] must be the day after ${previousDate}`);
    }
    if (!Number.isInteger(day.count) || day.count < 0) {
      fail(`days[${index}].count must be a non-negative integer`);
    }

    total += day.count;
    if (day.count > 0) activeDays += 1;
    previousDate = day.date;
  });

  if (data.days[0].date !== data.range.start) fail('range.start does not match days');
  if (data.days[data.days.length - 1].date !== data.range.end) {
    fail('range.end does not match days');
  }
  if (data.total !== total) fail('total does not match the sum of days');
  if (data.activeDays !== activeDays) fail('activeDays does not match days');
}

function datasetsEqual(existing, candidate) {
  return (
    existing.schemaVersion === candidate.schemaVersion &&
    existing.platform === candidate.platform &&
    existing.username === candidate.username &&
    existing.unit === candidate.unit &&
    existing.status === candidate.status &&
    existing.range.start === candidate.range.start &&
    existing.range.end === candidate.range.end &&
    existing.total === candidate.total &&
    existing.activeDays === candidate.activeDays &&
    JSON.stringify(existing.days) === JSON.stringify(candidate.days)
  );
}

async function readExistingDataset() {
  try {
    const text = await readFile(DATA_PATH, 'utf8');
    const data = JSON.parse(text);
    validateDataset(data);
    return data;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;

    console.warn(
      'Existing GitHub activity data is missing or invalid; it will be replaced only after a valid fetch.'
    );
    return null;
  }
}

async function writeJsonAtomic(data) {
  await mkdir(dirname(DATA_PATH), { recursive: true });

  const temporaryPath = `${DATA_PATH}.tmp-${process.pid}-${Date.now()}`;

  try {
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, DATA_PATH);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

async function main() {
  const token = (process.env.GITHUB_TOKEN ?? '').trim();

  if (!token) {
    throw new Error(
      'GITHUB_TOKEN is not set. Run this script in GitHub Actions or export a token locally.'
    );
  }

  const endDate = toDateString(new Date());
  const startDate = addDays(endDate, -(DAY_COUNT - 1));

  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'vishnu-portfolio-activity-fetcher',
    },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        login: USERNAME,
        from: `${startDate}T00:00:00Z`,
        to: `${endDate}T23:59:59Z`,
      },
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    throw new Error(
      `GitHub GraphQL request failed with HTTP ${response.status}. ` +
        'The Actions GITHUB_TOKEN may not have access to contribution data.'
    );
  }

  let payload;

  try {
    payload = await response.json();
  } catch {
    throw new Error('GitHub GraphQL returned invalid JSON.');
  }

  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    throw new Error(
      `GitHub GraphQL error: ${payload.errors
        .map((error) => error.message)
        .join('; ')}`
    );
  }

  const collection = payload.data?.user?.contributionsCollection;
  const calendar = collection?.contributionCalendar;

  if (!calendar || !Array.isArray(calendar.weeks)) {
    throw new Error(
      'GitHub GraphQL response did not contain a contribution calendar.'
    );
  }

  if (
    !Number.isInteger(collection.totalContributions) ||
    collection.totalContributions < 0
  ) {
    throw new Error(
      'GitHub GraphQL response did not contain a valid totalContributions value.'
    );
  }

  const counts = new Map();

  for (const week of calendar.weeks) {
    for (const day of week.contributionDays ?? []) {
      if (!isDateString(day.date)) {
        throw new Error('GitHub returned an invalid contribution date.');
      }
      if (!Number.isInteger(day.contributionCount) || day.contributionCount < 0) {
        throw new Error('GitHub returned an invalid contribution count.');
      }
      if (day.date < startDate || day.date > endDate) continue;
      if (counts.has(day.date)) {
        throw new Error(`GitHub returned a duplicate contribution date: ${day.date}`);
      }

      counts.set(day.date, day.contributionCount);
    }
  }

  // A truncated calendar would otherwise be zero-filled by buildDays and
  // silently replace a valid year with zeros.
  if (counts.size !== DAY_COUNT) {
    throw new Error(
      `GitHub returned an incomplete contribution calendar ` +
        `(${counts.size}/${DAY_COUNT} days). Existing data was preserved.`
    );
  }

  const days = buildDays(counts, startDate, endDate);
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const activeDays = days.filter((day) => day.count > 0).length;

  if (collection.totalContributions > 0 && total === 0) {
    throw new Error(
      'GitHub reported contributions but returned an all-zero calendar. ' +
        'Existing data was preserved.'
    );
  }

  if (collection.totalContributions !== total) {
    console.warn(
      `GitHub calendar total (${total}) differs from totalContributions ` +
        `(${collection.totalContributions}); using the calendar sum.`
    );
  }

  const candidate = {
    schemaVersion: SCHEMA_VERSION,
    platform: PLATFORM,
    username: USERNAME,
    unit: UNIT,
    status: 'ok',
    generatedAt: new Date().toISOString(),
    range: { start: startDate, end: endDate },
    total,
    activeDays,
    days,
  };

  validateDataset(candidate);

  const existing = await readExistingDataset();

  if (
    existing &&
    existing.total > 0 &&
    total === 0 &&
    process.env.ALLOW_EMPTY_ACTIVITY !== '1'
  ) {
    throw new Error(
      'Refusing to replace a non-empty GitHub dataset with an all-zero one. ' +
        'Set ALLOW_EMPTY_ACTIVITY=1 only if the account genuinely has no activity.'
    );
  }

  if (existing && datasetsEqual(existing, candidate)) {
    console.log(
      `GitHub activity unchanged (${total} contributions across ${activeDays} active days); data file left untouched.`
    );
    return;
  }

  await writeJsonAtomic(candidate);

  console.log(
    `GitHub activity: ${total} contributions across ${activeDays} active days.`
  );
  console.log(`Wrote ${DATA_PATH}`);
}

main().catch((error) => {
  console.error(`Failed to update GitHub activity: ${error.message}`);
  process.exitCode = 1;
});
