// 1時間ごとの時間主導型トリガーから呼ばれる定期判定処理の本体。
// 全クライアントを走査し、evaluateReminder(ReminderLogic.js)の判定結果に従って送信する。

function runReminderCheck() {
  withScriptLock(function () {
    runReminderCheckInternal_();
  }, 5 * 60 * 1000); // ジョブ全体を通してロックを保持し、Webhookとの同時書き込みを防ぐ
}

function runReminderCheckInternal_() {
  var now = new Date();
  var commonSettings = getCommonSettings();
  var clients = getClientRows();
  var templates = getTemplates();
  var isHoliday = isJapaneseHoliday(now); // ジョブ実行中は1回だけ計算(全クライアント共通)
  var isWithinWindow = isWithinBusinessWindow(now, commonSettings, isHoliday);

  var nowParts = toJstParts(now);
  var yearMonthKey = nowParts.year + '-' + pad2(nowParts.month);
  var monthlySentSoFar = getMonthlySentTotal(yearMonthKey);
  var quotaWarned = false;

  clients.forEach(function (client) {
    try {
      processClient_(client, {
        now: now,
        isWithinWindow: isWithinWindow,
        templates: templates,
        commonSettings: commonSettings,
        getMonthlySentSoFar: function () {
          return monthlySentSoFar;
        },
        addToMonthlySentSoFar: function (n) {
          monthlySentSoFar += n;
        },
        wasQuotaWarned: function () {
          return quotaWarned;
        },
        markQuotaWarned: function () {
          quotaWarned = true;
        }
      });
    } catch (clientErr) {
      appendLog({
        datetime: now,
        client: client.clientName,
        groupId: client.groupId,
        templateKey: '',
        count: 0,
        result: '失敗',
        error: 'クライアント処理エラー: ' + clientErr
      });
    }
  });
}

function processClient_(client, ctx) {
  var state = {
    lastHumanMessageAt: client.lastHumanMessageAt,
    lastReminderSentAt: client.lastReminderSentAt,
    reminderStage: client.reminderStage,
    consecutiveReminders: client.consecutiveReminders
  };
  var settings = {
    enabled: client.enabled,
    supportStart: client.supportStart,
    supportEnd: client.supportEnd,
    intervalDays: client.intervalDays,
    followupIntervalDays: client.followupIntervalDays
  };

  // まずクォータを「利用可能」とみなして事前判定する。enabled/支援期間/インターバル/
  // 送信可能時間帯のいずれかで対象外ならここで終わり、無駄なメンバー数API呼び出しを避けられる。
  var preCheck = evaluateReminder(state, settings, {
    now: ctx.now,
    isWithinBusinessWindow: ctx.isWithinWindow,
    isQuotaAvailable: true
  });
  if (!preCheck.shouldSend) {
    return;
  }

  var memberCount = getGroupMemberCountCached(client.groupId);
  var willExceed = willExceedMonthlyLimit(ctx.getMonthlySentSoFar(), memberCount, ctx.commonSettings.monthlyLimit);

  var result = evaluateReminder(state, settings, {
    now: ctx.now,
    isWithinBusinessWindow: ctx.isWithinWindow,
    isQuotaAvailable: !willExceed
  });

  if (!result.shouldSend) {
    if (result.reason === 'QUOTA_EXCEEDED' && !ctx.wasQuotaWarned()) {
      notifyAdminQuotaExceeded(
        ctx.commonSettings.adminEmail,
        ctx.getMonthlySentSoFar(),
        ctx.commonSettings.monthlyLimit,
        client.clientName
      );
      ctx.markQuotaWarned();
    }
    return;
  }

  var templateKey = result.templateKey === 'B' ? client.templateBKey : client.templateAKey;
  var body = ctx.templates[templateKey];
  if (!body) {
    appendLog({
      datetime: ctx.now,
      client: client.clientName,
      groupId: client.groupId,
      templateKey: templateKey,
      count: 0,
      result: '失敗',
      error: 'メッセージ文言シートにキーが見つかりません: ' + templateKey
    });
    return;
  }
  var text = renderTemplate(body, { client_name: client.clientName });

  try {
    pushLineMessage(client.groupId, text);
    ctx.addToMonthlySentSoFar(memberCount);
    var nextState = applySentUpdate(state, ctx.now);
    updateClientState(client.rowIndex, nextState);
    appendLog({
      datetime: ctx.now,
      client: client.clientName,
      groupId: client.groupId,
      templateKey: templateKey,
      count: memberCount,
      result: '成功',
      error: ''
    });
  } catch (sendErr) {
    appendLog({
      datetime: ctx.now,
      client: client.clientName,
      groupId: client.groupId,
      templateKey: templateKey,
      count: 0,
      result: '失敗',
      error: String(sendErr)
    });
    notifyAdminSendFailure(ctx.commonSettings.adminEmail, client.clientName, client.groupId, sendErr);
  }
}
