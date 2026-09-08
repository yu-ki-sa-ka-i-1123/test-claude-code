const {
  evaluateReminder,
  applySentUpdate,
  applyHumanMessageUpdate,
  isWithinBusinessWindow,
  toJstParts,
  latestDate
} = require('../src/ReminderLogic.js');

const DAY_MS = 24 * 60 * 60 * 1000;

// 2024-06-10 12:00:00 UTC == 2024-06-10 21:00:00 JST
const NOW = new Date('2024-06-10T12:00:00Z');

function daysAgo(base, days) {
  return new Date(base.getTime() - days * DAY_MS);
}
function daysLater(base, days) {
  return new Date(base.getTime() + days * DAY_MS);
}

function baseSettings(overrides) {
  return Object.assign(
    {
      enabled: true,
      supportStart: daysAgo(NOW, 60),
      supportEnd: daysLater(NOW, 60),
      intervalDays: 3,
      followupIntervalDays: 2
    },
    overrides
  );
}

function baseContext(overrides) {
  return Object.assign(
    {
      now: NOW,
      isWithinBusinessWindow: true,
      isQuotaAvailable: true
    },
    overrides
  );
}

describe('evaluateReminder: 状態遷移の仕様', () => {
  test('1. 期間未経過 → 送信しない', () => {
    const state = {
      lastHumanMessageAt: daysAgo(NOW, 1),
      lastReminderSentAt: null,
      reminderStage: 'A',
      consecutiveReminders: 0
    };
    const result = evaluateReminder(state, baseSettings(), baseContext());
    expect(result.shouldSend).toBe(false);
    expect(result.reason).toBe('INTERVAL_NOT_ELAPSED');
  });

  test('2. 期間経過 → A送信', () => {
    const state = {
      lastHumanMessageAt: daysAgo(NOW, 3),
      lastReminderSentAt: null,
      reminderStage: 'A',
      consecutiveReminders: 0
    };
    const settings = baseSettings();
    const result = evaluateReminder(state, settings, baseContext());
    expect(result.shouldSend).toBe(true);
    expect(result.templateKey).toBe('A');

    const next = applySentUpdate(state, NOW);
    expect(next.consecutiveReminders).toBe(1);
    expect(next.reminderStage).toBe('B');
    expect(next.lastReminderSentAt).toEqual(NOW);
  });

  test('3. A送信後さらに期間経過(followup_interval_days) → B送信', () => {
    // ケース2の続き: 1通目(A)送信後、consecutiveReminders=1, stage=B
    const afterFirstSend = {
      lastHumanMessageAt: daysAgo(NOW, 3),
      lastReminderSentAt: NOW,
      reminderStage: 'B',
      consecutiveReminders: 1
    };
    const settings = baseSettings();
    const now2 = daysLater(NOW, settings.followupIntervalDays);
    const result = evaluateReminder(afterFirstSend, settings, baseContext({ now: now2 }));
    expect(result.shouldSend).toBe(true);
    expect(result.templateKey).toBe('B');

    const next = applySentUpdate(afterFirstSend, now2);
    expect(next.consecutiveReminders).toBe(2);
    expect(next.reminderStage).toBe('A');
  });

  test('4. B送信後さらに期間経過 → A送信', () => {
    const afterSecondSend = {
      lastHumanMessageAt: daysAgo(NOW, 5),
      lastReminderSentAt: daysLater(NOW, 2),
      reminderStage: 'A',
      consecutiveReminders: 2
    };
    const settings = baseSettings();
    const now3 = daysLater(afterSecondSend.lastReminderSentAt, settings.followupIntervalDays);
    const result = evaluateReminder(afterSecondSend, settings, baseContext({ now: now3 }));
    expect(result.shouldSend).toBe(true);
    expect(result.templateKey).toBe('A');

    const next = applySentUpdate(afterSecondSend, now3);
    expect(next.consecutiveReminders).toBe(3);
    expect(next.reminderStage).toBe('A');
  });

  test('5. 4の後さらに経過 → A送信のまま継続', () => {
    const afterThirdSend = {
      lastHumanMessageAt: daysAgo(NOW, 7),
      lastReminderSentAt: daysLater(NOW, 4),
      reminderStage: 'A',
      consecutiveReminders: 3
    };
    const settings = baseSettings();
    const now4 = daysLater(afterThirdSend.lastReminderSentAt, settings.followupIntervalDays);
    const result = evaluateReminder(afterThirdSend, settings, baseContext({ now: now4 }));
    expect(result.shouldSend).toBe(true);
    expect(result.templateKey).toBe('A');

    const next = applySentUpdate(afterThirdSend, now4);
    expect(next.consecutiveReminders).toBe(4);
    expect(next.reminderStage).toBe('A');
  });

  test('6. 途中でレスあり → stageがAにリセットされる', () => {
    const midCycleState = {
      lastHumanMessageAt: daysAgo(NOW, 10),
      lastReminderSentAt: daysAgo(NOW, 2),
      reminderStage: 'B',
      consecutiveReminders: 1
    };
    const humanMsgAt = NOW;
    const next = applyHumanMessageUpdate(midCycleState, humanMsgAt);
    expect(next.reminderStage).toBe('A');
    expect(next.consecutiveReminders).toBe(0);
    expect(next.lastHumanMessageAt).toEqual(humanMsgAt);
    // last_reminder_sent_at は仕様上更新対象外
    expect(next.lastReminderSentAt).toEqual(midCycleState.lastReminderSentAt);
  });

  test('7. 支援期間終了後 → 送信しない', () => {
    const state = {
      lastHumanMessageAt: daysAgo(NOW, 10),
      lastReminderSentAt: null,
      reminderStage: 'A',
      consecutiveReminders: 0
    };
    const settings = baseSettings({ supportEnd: daysAgo(NOW, 1) });
    const result = evaluateReminder(state, settings, baseContext());
    expect(result.shouldSend).toBe(false);
    expect(result.reason).toBe('OUT_OF_SUPPORT_PERIOD');
  });

  test('8. 送信可能時間帯外 → 送信しない', () => {
    const state = {
      lastHumanMessageAt: daysAgo(NOW, 3),
      lastReminderSentAt: null,
      reminderStage: 'A',
      consecutiveReminders: 0
    };
    const settings = baseSettings();
    const result = evaluateReminder(
      state,
      settings,
      baseContext({ isWithinBusinessWindow: false })
    );
    expect(result.shouldSend).toBe(false);
    expect(result.reason).toBe('OUTSIDE_BUSINESS_WINDOW');
  });

  test('9. 月間上限超過 → 送信せず警告(QUOTA_EXCEEDED)', () => {
    const state = {
      lastHumanMessageAt: daysAgo(NOW, 3),
      lastReminderSentAt: null,
      reminderStage: 'A',
      consecutiveReminders: 0
    };
    const settings = baseSettings();
    const result = evaluateReminder(state, settings, baseContext({ isQuotaAvailable: false }));
    expect(result.shouldSend).toBe(false);
    expect(result.reason).toBe('QUOTA_EXCEEDED');
  });

  test('10. 同一日に2回判定が走る → 1回しか送らない', () => {
    const state = {
      lastHumanMessageAt: daysAgo(NOW, 3),
      lastReminderSentAt: null,
      reminderStage: 'A',
      consecutiveReminders: 0
    };
    const settings = baseSettings();
    const firstRun = evaluateReminder(state, settings, baseContext());
    expect(firstRun.shouldSend).toBe(true);

    const afterSend = applySentUpdate(state, NOW);
    // 同日中(1時間後、次のトリガー起動)に再度判定が走ったケースを想定。
    // NOWは21:00 JSTなので、日付をまたがない+1時間で検証する。
    const sameDayLater = new Date(NOW.getTime() + 1 * 60 * 60 * 1000);
    const secondRun = evaluateReminder(afterSend, settings, baseContext({ now: sameDayLater }));
    expect(secondRun.shouldSend).toBe(false);
    expect(secondRun.reason).toBe('ALREADY_SENT_TODAY');
  });
});

describe('isWithinBusinessWindow', () => {
  const windowConfig = {
    startHour: 10,
    startMinute: 0,
    endHour: 18,
    endMinute: 0,
    excludedWeekdays: [0, 6], // 日・土
    excludeHolidays: true
  };

  test('平日の時間帯内はtrue', () => {
    // 2024-06-10(月) 21:00 JST -> 12:00 JST にずらして検証
    const dt = new Date('2024-06-10T03:00:00Z'); // 12:00 JST 月曜
    expect(isWithinBusinessWindow(dt, windowConfig, false)).toBe(true);
  });

  test('時間帯外(21時)はfalse', () => {
    const dt = new Date('2024-06-10T12:00:00Z'); // 21:00 JST 月曜
    expect(isWithinBusinessWindow(dt, windowConfig, false)).toBe(false);
  });

  test('土日はfalse', () => {
    const dt = new Date('2024-06-08T03:00:00Z'); // 12:00 JST 土曜
    expect(isWithinBusinessWindow(dt, windowConfig, false)).toBe(false);
  });

  test('祝日除外ONで祝日ならfalse', () => {
    const dt = new Date('2024-06-10T03:00:00Z'); // 12:00 JST 月曜(平日時間帯内)
    expect(isWithinBusinessWindow(dt, windowConfig, true)).toBe(false);
  });
});

describe('toJstParts / latestDate ユーティリティ', () => {
  test('UTC→JST変換が正しい(+9h、DSTなし)', () => {
    const dt = new Date('2024-06-10T15:30:00Z');
    const parts = toJstParts(dt);
    expect(parts.dateKey).toBe('2024-06-11');
    expect(parts.hour).toBe(0);
    expect(parts.minute).toBe(30);
  });

  test('latestDateは新しい方を返す', () => {
    const a = new Date('2024-06-01T00:00:00Z');
    const b = new Date('2024-06-05T00:00:00Z');
    expect(latestDate(a, b)).toEqual(b);
    expect(latestDate(b, a)).toEqual(b);
    expect(latestDate(null, a)).toEqual(a);
    expect(latestDate(a, null)).toEqual(a);
    expect(latestDate(null, null)).toBeNull();
  });
});
