#!/usr/bin/env node
/**
 * Fetch the public LeetCode submission calendar for the portfolio.
 *
 * Data contract (shared with scripts/fetch-github-activity.mjs):
 * {
 *   "schemaVersion": 1,
 *   "platform": "leetcode",
 *   "username": "vishnu-s-tripathi06",
 *   "unit": "submissions",
 *   "status": "ok",
 *   "generatedAt": "2026-11-22T00:00:00.000Z",
 *   "range": { "start": "2025-11-23", "end": "2026-11-22" },
 *   "total": 123,
 *   "activeDays": 45,
 *   "days": [{ "date": "2025-11-23", "count": 0 }]
 * }
 *
 * `total` is the sum of `days[].count` and is never combined with GitHub
 * contribution counts. LeetCode values are submission counts, not unique
 * solved-problem counts. `generatedAt` is only advanced when data changes.
 * `status` is "ok" for fetched data; "pending" is reserved for a bootstrap
 * placeholder when no successful fetch has occurred yet.
 *
 * API notes:
 *   This uses LeetCode's unofficial public GraphQL endpoint. No cookies,
 *   session credentials, or passwords are sent. The query shape is validated
 *   because LeetCode can change it without notice.
 *
 * Failure behavior:
 *   The script validates the complete dataset before writing. If any request,
 *   parsing, or validation step fails, the existing data file is left untouched.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLATFORM = 'leetcode';
const USERNAME = 'vishnu-s-tripathi06';
const UNIT = 'submissions';
const SCHEMA_VERSION = 1;
const DAY_COUNT = 365;
const DATA_PATH = fileURLToPath(
  new URL('../data/leetcode-activity.json', import.meta.url)
);
const LEETCODE_URL = 'https://leetcode.com/graphql/';
const MAX_ATTEMPTS = 3;

const QUERY = `query UserCalendar($username: String!, $year: Int) {
  matchedUser(username: $username) {
    userCalendar(year: $year) {
      submissionCalendar
    }
  }
}`;

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

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
    throw new Error(`Invalid LeetCode activity dataset: ${message}`);
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
      'Existing LeetCode activity data is missing or invalid; it will be replaced only after a valid fetch.'
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

async function requestYear(year) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(LEETCODE_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Origin: 'https://leetcode.com',
          Referer: `https://leetcode.com/${USERNAME}/`,
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/120.0 Safari/537.36',
        },
        body: JSON.stringify({
          query: QUERY,
          variables: { username: USERNAME, year },
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (response.status === 429 || response.status >= 500) {
        throw new Error(`LeetCode HTTP ${response.status}`);
      }

      if (!response.ok) {
        throw new Error(`LeetCode HTTP ${response.status}`);
      }

      const payload = await response.json();

      if (Array.isArray(payload.errors) && payload.errors.length > 0) {
        throw new Error(
          `LeetCode GraphQL error: ${payload.errors
            .map((error) => error.message)
            .join('; ')}`
        );
      }

      const user = payload.data?.matchedUser;

      if (!user) {
        throw new Error(`LeetCode user not found: ${USERNAME}`);
      }

      if (!user.userCalendar) {
        throw new Error(
          `LeetCode did not return a calendar for ${year}. Existing data was preserved.`
        );
      }

      return user.userCalendar;
    } catch (error) {
      lastError = error;

      const retryable =
        error?.name === 'TimeoutError' ||
        error?.name === 'AbortError' ||
        error instanceof TypeError ||
        /HTTP (429|5\d\d)/.test(error.message);

      if (attempt < MAX_ATTEMPTS && retryable) {
        await sleep(1000 * 2 ** (attempt - 1));
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

async function main() {
  const endDate = toDateString(new Date());
  const startDate = addDays(endDate, -(DAY_COUNT - 1));
  const currentYear = new Date().getUTCFullYear();
  const years = [currentYear - 1, currentYear];
  const counts = new Map();

  for (const year of years) {
    const calendar = await requestYear(year);
    const rawCalendar = calendar.submissionCalendar;

    if (rawCalendar === null || rawCalendar === undefined || rawCalendar === '') {
      throw new Error(
        `LeetCode returned an empty submission calendar for ${year}. ` +
          'Existing data was preserved.'
      );
    }

    let parsedCalendar;

    try {
      parsedCalendar =
        typeof rawCalendar === 'string' ? JSON.parse(rawCalendar) : rawCalendar;
    } catch {
      throw new Error(`LeetCode returned an invalid submissionCalendar for ${year}.`);
    }

    if (
      !parsedCalendar ||
      typeof parsedCalendar !== 'object' ||
      Array.isArray(parsedCalendar)
    ) {
      throw new Error(`LeetCode returned an invalid submissionCalendar for ${year}.`);
    }

    const activeDates = new Set();

    for (const [timestamp, rawCount] of Object.entries(parsedCalendar)) {
      const seconds = Number(timestamp);
      const count = Number(rawCount);

      if (
        !Number.isInteger(seconds) ||
        seconds < 1_000_000_000 ||
        seconds >= 10_000_000_000
      ) {
        throw new Error(
          `LeetCode returned an invalid submission timestamp for ${year}.`
        );
      }

      if (!Number.isInteger(count) || count < 0) {
        throw new Error(`LeetCode returned an invalid submission count for ${year}.`);
      }

      const date = new Date(seconds * 1000).toISOString().slice(0, 10);
      counts.set(date, (counts.get(date) ?? 0) + count);
      activeDates.add(date);
    }

    console.log(
      `LeetCode calendar for ${year}: ${activeDates.size} active dates returned.`
    );
  }

  const days = buildDays(counts, startDate, endDate);
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const activeDays = days.filter((day) => day.count > 0).length;

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
      'Refusing to replace a non-empty LeetCode dataset with an all-zero one. ' +
        'Set ALLOW_EMPTY_ACTIVITY=1 only if the account genuinely has no activity.'
    );
  }

  if (existing && datasetsEqual(existing, candidate)) {
    console.log(
      `LeetCode activity unchanged (${total} submissions across ${activeDays} active days); data file left untouched.`
    );
    return;
  }

  await writeJsonAtomic(candidate);

  console.log(
    `LeetCode activity: ${total} submissions across ${activeDays} active days.`
  );
  console.log(`Wrote ${DATA_PATH}`);
}

main().catch((error) => {
  console.error(`Failed to update LeetCode activity: ${error.message}`);
  process.exitCode = 1;
});
